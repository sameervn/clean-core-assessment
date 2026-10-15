/**
 * Browser-local workspace persistence (IndexedDB) plus backup validation.
 * The workspace is saved only in this browser. Evidence is sent to this app's
 * backend for normalization and assessment runs, but is not retained there.
 */

import type { AiNarratives } from "./ai-narratives";

export const EVIDENCE_TYPE_IDS = [
  "atc", "cloud-readiness", "custom-code", "usage", "modifications", "enhancements",
  "object-metadata", "interfaces", "readiness-check", "cloud-alm", "process-data",
] as const;

export interface StoredWorkspace {
  system: string;
  targetRelease: string;
  weighted: boolean;
  evidence: any[];
  assessment: any | null;
  classificationOverrides: any[] | null;
  narratives: Record<string, string>;
  aiNarratives?: AiNarratives;
  baseline: { targetRelease?: string; cleanCoreShare: number; technicalDebtScore: number; inventory: Array<{ id: string; classification: string }> } | null;
  savedAt?: string;
}

export const BACKUP_FORMAT = "clean-core-workspace-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
const MAX_NARRATIVES = 10_000;
const MAX_NARRATIVE_CHARS = 20_000;
const MAX_INVENTORY = 200_000;

export function emptyWorkspace(): StoredWorkspace {
  return {
    system: "PRD", targetRelease: "S4HANA_2025", weighted: true,
    evidence: [], assessment: null, classificationOverrides: null, narratives: {}, baseline: null,
  };
}

const LEGACY_DB_NAME = "clean-core-assessment"; // pre-accounts, anonymous workspace
const STORE = "workspace";
const KEY = "current";
const CLAIM_KEY = "claimedBy";

export class WorkspaceConflictError extends Error {
  constructor() {
    super("Another tab saved a newer workspace. Download this tab's backup before loading the newer saved workspace.");
    this.name = "WorkspaceConflictError";
  }
}

export class WorkspaceClosedError extends Error {
  constructor() {
    super("The signed-in account changed. This write was cancelled so it cannot reach another account's workspace.");
    this.name = "WorkspaceClosedError";
  }
}

/** Key for any other per-user browser storage (recovery drafts, prefs). */
export function scopedStorageKey(scope: string, name: string) {
  return `clean-core:${scope}:${name}`;
}

function openDb(name: string, onConnectionClosed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available in this browser."));
    let rejected = false;
    const fail = (error: Error) => { rejected = true; reject(error); };
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      const database = req.result;
      if (rejected) { database.close(); return; }
      database.onversionchange = () => { database.close(); onConnectionClosed(); };
      database.onclose = onConnectionClosed;
      resolve(database);
    };
    req.onerror = () => fail(req.error || new Error("Could not open browser storage."));
    req.onblocked = () => fail(new Error("Browser storage is blocked by another tab."));
  });
}

function getRaw(database: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface WorkspaceStore {
  database(): Promise<IDBDatabase>;
  /** Immutable scope (authenticated user id). */
  readonly scope: string;
  load(): Promise<{ workspace: StoredWorkspace | null; revision: string | null; discarded: boolean; unreadable?: { raw: unknown } }>;
  save(ws: StoredWorkspace, expectedRevision: string | null): Promise<string>;
  readRevision(): Promise<string | null>;
  subscribe(onChange: () => void): () => void;
  /** After dispose every pending/future operation rejects; nothing is deleted. */
  dispose(): void;
  readonly disposed: boolean;
}

/**
 * Open a workspace handle bound to one authenticated user id. The scope is
 * captured once; a handle can never be re-pointed at another user, so stale
 * autosaves from a previous account fail closed instead of leaking across.
 */
export function openWorkspaceStore(userId: string | number): WorkspaceStore {
  const scope = `user-${String(userId)}`;
  const dbName = `${LEGACY_DB_NAME}::${scope}`;
  const channelName = `clean-core-workspace-changed::${scope}`;
  let disposed = false;
  let dbPromise: Promise<IDBDatabase> | null = null;
  const unsubscribers = new Set<() => void>();
  const guard = () => { if (disposed) throw new WorkspaceClosedError(); };
  const db = () => {
    guard();
    if (!dbPromise) {
      const reset = () => { if (dbPromise === pending) dbPromise = null; };
      const pending = openDb(dbName, reset).catch((e) => { reset(); throw e; });
      dbPromise = pending;
    }
    return dbPromise;
  };

  return {
    scope,
    async database() {
      const database = await db();
      guard();
      return database;
    },
    get disposed() { return disposed; },
    async load() {
      const raw = await getRaw(await db(), KEY);
      guard();
      const revision = revisionOf(raw);
      if (raw == null) return { workspace: null, revision, discarded: false };
      try {
        const result = validateWorkspace(raw);
        if (result.ok) return { workspace: result.workspace, revision, discarded: false };
      } catch { /* malformed structured-clone values */ }
      return { workspace: null, revision, discarded: true, unreadable: { raw } };
    },
    async readRevision() {
      const raw = await getRaw(await db(), KEY);
      guard();
      return revisionOf(raw);
    },
    async save(ws, expectedRevision) {
      const database = await db();
      guard();
      const revision = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let failure: Error | null = null;
        const read = store.get(KEY);
        read.onsuccess = () => {
          try {
            if (disposed) throw new WorkspaceClosedError();
            if (revisionOf(read.result) !== expectedRevision) throw new WorkspaceConflictError();
            store.put({ ...ws, savedAt: new Date().toISOString(), revision }, KEY);
          } catch (error) {
            failure = error as Error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Write failed"));
        tx.onabort = () => reject(failure || tx.error || new Error("Write aborted (storage quota may be exceeded)."));
      });
      try {
        const channel = new BroadcastChannel(channelName);
        channel.postMessage("changed");
        channel.close();
      } catch { /* notification failure never turns a committed save into an error */ }
      return revision;
    },
    subscribe(onChange) {
      if (disposed) return () => undefined;
      const fire = () => { if (!disposed) onChange(); };
      let channel: BroadcastChannel | undefined;
      try {
        channel = new BroadcastChannel(channelName);
        channel.onmessage = fire;
      } catch { /* focus checks still work */ }
      const onVisible = () => { if (document.visibilityState === "visible") fire(); };
      window.addEventListener("focus", fire);
      document.addEventListener("visibilitychange", onVisible);
      const off = () => {
        channel?.close();
        window.removeEventListener("focus", fire);
        document.removeEventListener("visibilitychange", onVisible);
        unsubscribers.delete(off);
      };
      unsubscribers.add(off);
      return off;
    },
    dispose() {
      disposed = true;
      [...unsubscribers].forEach(off => off());
      dbPromise?.then(d => d.close()).catch(() => undefined);
      dbPromise = null;
    },
  };
}

// ---------- anonymous (pre-accounts) workspace: explicit one-time claim ----------

async function legacyDbExists(): Promise<boolean> {
  const list = (indexedDB as any).databases as undefined | (() => Promise<Array<{ name?: string }>>);
  if (!list) return true; // cannot tell without opening; opening creates an empty DB which reads as "nothing"
  try { return (await list.call(indexedDB)).some(d => d.name === LEGACY_DB_NAME); } catch { return true; }
}

export interface AnonymousWorkspaceInfo { exists: boolean; claimedBy: string | null; savedAt?: string; valid: boolean }

/** Metadata only: never returns workspace content. Admin UI only. */
export async function inspectAnonymousWorkspace(): Promise<AnonymousWorkspaceInfo> {
  if (typeof indexedDB === "undefined" || !(await legacyDbExists())) return { exists: false, claimedBy: null, valid: false };
  const database = await openDb(LEGACY_DB_NAME, () => undefined);
  try {
    const [raw, claim] = await Promise.all([getRaw(database, KEY), getRaw(database, CLAIM_KEY)]);
    if (raw == null) return { exists: false, claimedBy: null, valid: false };
    let valid = false;
    try { valid = validateWorkspace(raw).ok; } catch { valid = false; }
    return { exists: true, claimedBy: typeof claim === "string" ? claim : null, savedAt: (raw as any)?.savedAt, valid };
  } finally { database.close(); }
}

const CLAIM_LOCK = "clean-core-anonymous-claim";

async function withClaimLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as any).locks as undefined | { request: (name: string, opts: object, cb: () => Promise<T>) => Promise<T> };
  if (!locks) throw new Error("This browser cannot coordinate a safe one-time import (Web Locks unavailable).");
  return locks.request(CLAIM_LOCK, { mode: "exclusive" }, fn);
}

/**
 * Explicit one-time Admin claim of the anonymous workspace.
 * Under an exclusive cross-tab lock: verify unclaimed + valid, run `commit`
 * (the scoped save), and only after it succeeds record the claim. A failed
 * commit leaves the record unclaimed and retryable. The original is kept.
 */
export async function claimAnonymousWorkspace(claimer: string, commit: (ws: StoredWorkspace) => Promise<void>): Promise<void> {
  await withClaimLock(async () => {
    const database = await openDb(LEGACY_DB_NAME, () => undefined);
    try {
      const [claim, raw] = await Promise.all([getRaw(database, CLAIM_KEY), getRaw(database, KEY)]);
      if (typeof claim === "string") throw new Error("This browser's earlier workspace was already claimed or declined.");
      let check: Result;
      try { check = validateWorkspace(raw); } catch { check = { ok: false, error: "unreadable" }; }
      if (!check.ok) throw new Error(`The earlier workspace cannot be imported: ${check.error}.`);
      const snapshotRevision = revisionOf(raw);
      await commit(check.workspace);
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let failure: Error | null = null;
        const c = store.get(CLAIM_KEY);
        const r = store.get(KEY);
        r.onsuccess = () => {
          if (typeof c.result === "string") { failure = new Error("Claimed concurrently."); tx.abort(); return; }
          if (revisionOf(r.result) !== snapshotRevision) { failure = new Error("The earlier workspace changed during import."); tx.abort(); return; }
          store.put(claimer, CLAIM_KEY);
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(failure || tx.error || new Error("Could not record the claim."));
        tx.onerror = () => reject(tx.error || new Error("Could not record the claim."));
      });
    } finally { database.close(); }
  });
}

/** Record a "keep it untouched" decision so the prompt stops (data is kept). */
export async function declineAnonymousWorkspace(claimer: string): Promise<void> {
  await withClaimLock(async () => {
    const database = await openDb(LEGACY_DB_NAME, () => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const c = store.get(CLAIM_KEY);
        c.onsuccess = () => { if (typeof c.result !== "string") store.put(`declined:${claimer}`, CLAIM_KEY); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { database.close(); }
  });
}

// ---------- validation ----------

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max: number, min = 0) => typeof v === "string" && v.length >= min && v.length <= max;
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const optArr = (v: unknown) => v === undefined || v === null || Array.isArray(v);
const optStr = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.length <= 20_000);
const ITEM_STRING_FIELDS = [
  "objectName", "objectType", "module", "package", "classification", "disposition", "confidence",
  "classificationExplanation", "interfaceName", "interfaceType", "interfaceDirection", "sourceSystem",
  "targetSystem", "releaseStatus", "dimension", "extensibilityTier",
] as const;
const optObj = (v: unknown) => v === undefined || v === null || isObj(v);

type Result = { ok: true; workspace: StoredWorkspace } | { ok: false; error: string };

function validateEvidence(list: unknown): string | null {
  if (!Array.isArray(list)) return "evidence must be a list";
  if (list.length > EVIDENCE_TYPE_IDS.length) return "too many evidence sets";
  if (new Set(list.map(e => e?.type)).size !== list.length) return "duplicate evidence types";
  if (new Blob([JSON.stringify(list)]).size > 16_000_000) return "normalized evidence exceeds 16 MB";
  let rowCount = 0;
  for (const e of list) {
    if (!isObj(e)) return "evidence entry is not an object";
    if (!(EVIDENCE_TYPE_IDS as readonly string[]).includes(e.type)) return "unknown evidence type";
    if (!Array.isArray(e.rows)) return "evidence rows must be a list";
    rowCount += e.rows.length;
    if (rowCount > 20_000) return "evidence exceeds 20,000 rows";
    if (!e.rows.every((row: unknown) => isObj(row) && isStr(row.objectName, 500, 1)
      && Object.values(row).every(value => typeof value === "string" || typeof value === "boolean" || isNum(value)))) return "invalid normalized evidence row";
    if (!isStr(e.attestation, 10_000, 1)) return "evidence attestation missing";
    if (!isObj(e.metadata)) return "evidence metadata missing";
    for (const key of ["source", "importedAt", "collectionStart", "collectionEnd", "freshness", "confidence"]) {
      if (e.metadata[key] !== undefined && !isStr(e.metadata[key], 2000)) return "invalid evidence metadata";
    }
    if (e.fileName !== undefined && !isStr(e.fileName, 1000)) return "invalid evidence file name";
    if (e.count !== undefined && !isNum(e.count)) return "invalid evidence count";
  }
  return null;
}

function validateAssessment(a: unknown): string | null {
  if (a === null) return null;
  if (!isObj(a)) return "assessment is not an object";
  if (!isStr(a.system, 100) || !isStr(a.targetRelease, 50)) return "assessment context invalid";
  if (!isNum(a.cleanCoreShare) || !isNum(a.technicalDebtScore)) return "assessment scores invalid";
  if (!isObj(a.provenance) || !isStr(a.provenance.generatedAt, 100) || !isStr(a.provenance.engineVersion, 200)) return "assessment provenance invalid";
  if (!isObj(a.totals) || !isNum(a.totals.objects)) return "assessment totals invalid";
  if (!isObj(a.evidenceQuality) || !isStr(a.evidenceQuality.confidence, 50)) return "evidence quality invalid";
  if (!isObj(a.roadmap) || !Array.isArray(a.roadmap.waves) || !a.roadmap.waves.every(isObj)) return "roadmap invalid";
  if (!Array.isArray(a.inventory) || a.inventory.length > MAX_INVENTORY) return "inventory invalid";
  for (const item of a.inventory) {
    if (!isObj(item) || !isStr(item.id, 1000, 1)) return "inventory item invalid";
    if (item.classification !== undefined && !isStr(item.classification, 10)) return "inventory classification invalid";
    if (!optObj(item.mitigation) || !optObj(item.classificationReason) || !optObj(item.solutionRecommendation) || !optObj(item.recommendation)) return "inventory item fields invalid";
    if (!optArr(item.dependencies) || (Array.isArray(item.dependencies) && !item.dependencies.every((d: unknown) => typeof d === "string"))) return "inventory dependencies invalid";
    for (const k of ITEM_STRING_FIELDS) if (!optStr(item[k])) return `inventory ${k} invalid`;
    for (const k of ["usageCount", "complexity"]) if (item[k] !== undefined && item[k] !== null && !isNum(item[k])) return `inventory ${k} invalid`;
    if (isObj(item.classificationReason) && !optStr(item.classificationReason.summary)) return "inventory classification reason invalid";
    if (isObj(item.mitigation) && (!optStr(item.mitigation.recommendedAction) || !optStr(item.mitigation.validation))) return "inventory mitigation invalid";
  }
  if (!isObj(a.rollups)) return "rollups missing";
  for (const key of ["clusters", "levelD", "deadCode", "duplicates", "integrations", "recommendations", "quickWins", "upgradeRisk"]) {
    if (!Array.isArray(a[key])) return `${key} must be a list`;
  }
  if (!Array.isArray(a.evidenceQuality.gaps)) return "evidence quality gaps invalid";
  for (const wave of a.roadmap.waves) {
    for (const key of ["exitCriteria", "prerequisites", "mitigationSteps", "objectIds"]) {
      if (!optArr(wave[key])) return "roadmap wave fields invalid";
    }
    for (const key of ["name", "objective", "expectedOutcome", "rationale"]) if (!optStr(wave[key])) return "roadmap wave text invalid";
    if (wave.count !== undefined && wave.count !== null && !isNum(wave.count)) return "roadmap wave count invalid";
  }
  return null;
}

function validateOverrides(o: unknown): string | null {
  if (o === null || o === undefined) return null;
  if (!Array.isArray(o) || o.length > 500) return "classification overrides invalid";
  for (const r of o) {
    if (!isObj(r) || !["A", "B", "C", "D"].includes(r.level)) return "override level invalid";
    for (const [k, max] of [["finding", 200], ["category", 100], ["objectPattern", 200], ["reason", 500]] as const) {
      if (r[k] !== undefined && !isStr(r[k], max)) return `override ${k} invalid`;
    }
  }
  return null;
}

function validateNarratives(n: unknown): string | null {
  if (!isObj(n)) return "narratives invalid";
  const entries = Object.entries(n);
  if (entries.length > MAX_NARRATIVES) return "too many narratives";
  if (!entries.every(([k, v]) => k.length <= 1000 && isStr(v, MAX_NARRATIVE_CHARS))) return "narrative entry invalid";
  return null;
}

function validateAiNarratives(value: unknown): string | null {
  if (value === undefined) return null; // Version 1 backups predate optional AI.
  if (!isObj(value) || Object.keys(value).length > MAX_NARRATIVES) return "AI narratives invalid";
  for (const [key, note] of Object.entries(value)) {
    if (!/^(object|interface):.{1,1000}$/.test(key) || !isObj(note)
       || Object.keys(note).some(k => !["text", "provider", "model", "generatedAt", "acceptedAt", "summaryFingerprint", "sources", "knowledgeMode", "knowledgeDisclosure"].includes(k))
      || (note.summaryFingerprint !== undefined && !isStr(note.summaryFingerprint, 4096, 1))
      || !isStr(note.text, 6000, 1) || !["openai", "azure", "deere-gateway"].includes(note.provider)
      || typeof note.model !== "string" || !(note.provider === "deere-gateway" ? /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/ : /^[a-zA-Z0-9._-]{1,100}$/).test(note.model)
      || ![note.generatedAt, note.acceptedAt].every(d => isStr(d, 40, 1) && Number.isFinite(Date.parse(d)))) return "AI narrative attribution invalid";
     if (note.knowledgeMode !== undefined && !["knowledge-only", "allow-fallback"].includes(note.knowledgeMode)) return "AI knowledge mode invalid";
     if (note.knowledgeDisclosure !== undefined && !isStr(note.knowledgeDisclosure, 2000)) return "AI knowledge disclosure invalid";
     if (note.sources !== undefined && (!Array.isArray(note.sources) || note.sources.length > 4 || !note.sources.every((s: any) =>
       isObj(s) && Object.keys(s).every(k => ["id", "title", "version", "section", "release", "applicability"].includes(k))
       && typeof s.id === "string" && /^[0-9a-f-]{36}$/i.test(s.id) && isStr(s.title, 200, 1) && Number.isInteger(s.version) && s.version >= 1
       && isStr(s.section, 160) && isStr(s.release, 50, 1) && ["target-release", "general", "other-release"].includes(s.applicability)))) return "AI source metadata invalid";
   }
  return null;
}

function validateBaseline(b: unknown): string | null {
  if (b === null || b === undefined) return null;
  if (!isObj(b) || !isNum(b.cleanCoreShare) || !isNum(b.technicalDebtScore) || !Array.isArray(b.inventory)) return "baseline invalid";
  if (b.targetRelease !== undefined && !isStr(b.targetRelease, 50, 1)) return "baseline target invalid";
  if (b.inventory.length > MAX_INVENTORY) return "baseline too large";
  if (!b.inventory.every((i: unknown) => isObj(i) && isStr(i.id, 1000) && isStr(i.classification, 10))) return "baseline entries invalid";
  return null;
}

export function validateWorkspace(raw: unknown): Result {
  if (!isObj(raw)) return { ok: false, error: "workspace is not an object" };
  if (!isStr(raw.system, 100, 1)) return { ok: false, error: "system must be 1-100 characters" };
  if (!isStr(raw.targetRelease, 50, 1)) return { ok: false, error: "target release must be 1-50 characters" };
  if (typeof raw.weighted !== "boolean") return { ok: false, error: "weighted must be true/false" };
  const assessment = raw.assessment ?? null;
  const narratives = raw.narratives ?? {};
  const error =
    validateEvidence(raw.evidence) || validateAssessment(assessment) || validateOverrides(raw.classificationOverrides) ||
    validateNarratives(narratives) || validateAiNarratives(raw.aiNarratives) || validateBaseline(raw.baseline);
  if (error) return { ok: false, error };
  return {
    ok: true,
    workspace: {
      system: raw.system, targetRelease: raw.targetRelease, weighted: raw.weighted,
      evidence: raw.evidence, assessment,
      classificationOverrides: raw.classificationOverrides ?? null,
      narratives, aiNarratives: raw.aiNarratives ?? {}, baseline: raw.baseline ?? null,
    },
  };
}

export function buildBackup(ws: StoredWorkspace) {
  const { savedAt: _ignored, ...workspace } = ws;
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), workspace };
}

export function parseBackup(text: string): Result {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "File is not valid JSON." }; }
  if (!isObj(parsed) || parsed.format !== BACKUP_FORMAT) return { ok: false, error: "Not a Clean Core workspace backup." };
  if (parsed.version !== BACKUP_VERSION) return { ok: false, error: `Unsupported backup version ${String(parsed.version)}.` };
  const result = validateWorkspace(parsed.workspace);
  return result.ok ? result : { ok: false, error: `Backup rejected: ${result.error}.` };
}

function revisionOf(raw: any): string | null {
  if (raw == null) return null;
  if (typeof raw.revision === "string") return raw.revision;
  try {
    return `legacy:${JSON.stringify(raw)}`;
  } catch {
    // IndexedDB accepts cycles and BigInts, unlike JSON. Compare their complete
    // graph rather than sharing an "unreadable" sentinel (which could overwrite
    // a different malformed record saved since hydration).
    const seen = new Map<object, number>();
    const encode = (value: any): unknown => {
      if (value === null) return ["null"];
      if (typeof value === "bigint") return ["bigint", value.toString()];
      if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
      if (typeof value !== "object") return [typeof value, value];
      if (seen.has(value)) return ["ref", seen.get(value)];
      const id = seen.size;
      seen.set(value, id);
      if (Array.isArray(value)) return ["array", id, value.length, Object.entries(value).map(([key, item]) => [key, encode(item)])];
      if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
        return ["object", id, Object.keys(value).map(key => [key, encode(value[key])])];
      }
      // Do not silently drop opaque structured-clone contents from a revision.
      throw new Error("Unsupported structured-clone revision value");
    };
    try {
      return `structured:${JSON.stringify(encode(raw))}`;
    } catch {
      // Fail closed for other exotic/deep records, but still show recovery.
      return `uncomparable:${crypto.randomUUID()}`;
    }
  }
}

export async function writePendingClassification(workspaceStore: WorkspaceStore, draft: PendingClassification, remove = false): Promise<void> {
  const database = await workspaceStore.database();
  if (workspaceStore.disposed) throw new WorkspaceClosedError();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const read = store.get(PENDING_CLASSIFICATION_KEY);
    let failure: Error | null = null;
    read.onsuccess = () => {
      if (workspaceStore.disposed) {
        failure = new WorkspaceClosedError();
        tx.abort();
      } else if (read.result && read.result.id !== draft.id) {
        failure = new Error("Another tab has pending classification changes. Download your rules before reloading.");
        tx.abort();
      } else if (remove) store.delete(PENDING_CLASSIFICATION_KEY);
      else store.put(draft, PENDING_CLASSIFICATION_KEY);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("Could not save pending classification recovery data."));
  });
}

export async function classificationOrigin(ws: StoredWorkspace): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([
    ws.system, ws.targetRelease, ws.weighted, ws.evidence,
    ws.assessment, ws.classificationOverrides,
  ]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

const PENDING_CLASSIFICATION_KEY = "pending-classification";

export async function loadPendingClassification(workspaceStore: WorkspaceStore): Promise<PendingClassification | null> {
  const database = await workspaceStore.database();
  const raw = await new Promise<any>((resolve, reject) => {
    const tx = database.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(PENDING_CLASSIFICATION_KEY);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Could not read pending classification changes."));
  });
  if (workspaceStore.disposed) throw new WorkspaceClosedError();
  if (raw == null) return null;
  if (raw.version !== 1 || typeof raw.id !== "string" || typeof raw.origin !== "string"
    || !Array.isArray(raw.rules) || !raw.rules.every((rule: any) =>
      rule && typeof rule.objectPattern === "string" && typeof rule.reason === "string"
      && ["A", "B", "C", "D"].includes(rule.level))) {
    throw new Error("Pending classification recovery data is unreadable. It has not been changed.");
  }
  return raw;
}

export interface PendingClassification {
  version: 1;
  id: string;
  origin: string;
  rules: Array<{ objectPattern: string; level: string; reason: string }>;
}
