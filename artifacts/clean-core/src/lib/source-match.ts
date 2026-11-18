/**
 * Pure name/type matching between an assessed SAP object and repository files.
 * Never fuzzy: only exact (namespace-encoded, case-insensitive) object names are candidates,
 * and nothing is attached without explicit user confirmation.
 */
export interface RepoFile { path: string; size?: number; sha?: string }
export interface ParsedSourcePath { path: string; folder: string; base: string; name: string; type: string | null; part: string | null; ext: string }
export interface MatchGroup { id: string; folder: string; type: string | null; main: string | null; related: string[]; paths: string[]; truncated: boolean }
export type MatchStatus = "exact" | "ambiguous" | "unmatched" | "invalid";
export interface MatchResult { status: MatchStatus; target: string; type: string | null; groups: MatchGroup[] }

export const MAX_SOURCE_PATHS = 10;

const TYPE_ALIASES: Record<string, string> = {
  class: "clas", clas: "clas", "global class": "clas",
  interface: "intf", intf: "intf",
  program: "prog", prog: "prog", report: "prog", include: "prog",
  "function group": "fugr", fugr: "fugr", function: "fugr", func: "fugr", "function module": "fugr",
  ddls: "ddls", cds: "ddls", "cds view": "ddls", "data definition": "ddls",
  tabl: "tabl", table: "tabl", structure: "tabl",
  dtel: "dtel", "data element": "dtel", doma: "doma", domain: "doma", ttyp: "ttyp", "table type": "ttyp",
  enho: "enho", enhancement: "enho", "enhancement implementation": "enho", enhs: "enhs",
  bdef: "bdef", "behavior definition": "bdef", srvd: "srvd", srvb: "srvb", sicf: "sicf",
  xslt: "xslt", tran: "tran", transaction: "tran", msag: "msag", "message class": "msag", ssfo: "ssfo", sfpf: "sfpf",
};

/** Normalizes "CLAS", "Class", "class" etc. to an abapGit 4-letter type, or null when unknown. */
export function normalizeObjectType(type: unknown): string | null {
  const s = String(type ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!s) return null;
  if (TYPE_ALIASES[s]) return TYPE_ALIASES[s];
  return /^[a-z]{4}$/.test(s) ? s : null;
}

/** abapGit encodes namespaces as #ns#name and lower-cases names. */
export function encodeObjectName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase().replace(/\//g, "#");
}

function decodeName(raw: string): string {
  let v = raw;
  try { v = decodeURIComponent(raw); } catch { /* keep raw */ }
  return v.toLowerCase().replace(/\//g, "#");
}

export function parseSourcePath(path: string): ParsedSourcePath {
  const clean = path.replace(/\\/g, "/");
  const cut = clean.lastIndexOf("/");
  const folder = cut >= 0 ? clean.slice(0, cut) : "";
  const base = cut >= 0 ? clean.slice(cut + 1) : clean;
  const segs = base.split(".");
  const ext = segs.length > 1 ? segs[segs.length - 1].toLowerCase() : "";
  if (segs.length >= 3 && /^[a-z]{4}$/i.test(segs[1])) {
    return { path, folder, base, name: decodeName(segs[0]), type: segs[1].toLowerCase(), part: segs.slice(2, -1).join(".").toLowerCase() || null, ext };
  }
  const name = segs.length > 1 ? segs.slice(0, -1).join(".") : base;
  return { path, folder, base, name: decodeName(name), type: null, part: null, ext };
}

const MAIN_EXT = new Set(["abap", "asprog", "asclas", "asintf", "acds", "ddls", "asddls", "asbdef", "asdcls", "srvdsrv"]);
const rank = (p: ParsedSourcePath) => (p.ext === "abap" ? 0 : MAIN_EXT.has(p.ext) ? 1 : p.ext === "xml" ? 3 : 2);

export function matchSourceFiles(files: readonly RepoFile[], object: { name: unknown; type?: unknown }): MatchResult {
  const target = encodeObjectName(object.name);
  const type = normalizeObjectType(object.type);
  if (!target) return { status: "invalid", target, type, groups: [] };
  const byGroup = new Map<string, ParsedSourcePath[]>();
  for (const f of files) {
    const p = parseSourcePath(f.path);
    if (p.name !== target) continue;
    if (type && p.type && p.type !== type) continue;
    const id = `${p.folder}|${p.type ?? ""}`;
    byGroup.set(id, [...(byGroup.get(id) || []), p]);
  }
  const groups: MatchGroup[] = [...byGroup.entries()].map(([id, list]) => {
    const mains = list.filter(p => p.part === null && MAIN_EXT.has(p.ext));
    const main = mains.length === 1 ? mains[0].path : null;
    const related = list.filter(p => p.path !== main)
      .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path)).map(p => p.path);
    const all = main ? [main, ...related] : related;
    return { id, folder: list[0].folder, type: list[0].type, main, related, paths: all.slice(0, MAX_SOURCE_PATHS), truncated: all.length > MAX_SOURCE_PATHS };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const status: MatchStatus = groups.length === 0 ? "unmatched" : groups.length === 1 && groups[0].main ? "exact" : "ambiguous";
  return { status, target, type, groups };
}
