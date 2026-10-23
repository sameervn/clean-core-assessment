import test from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { mkdtemp, rm, readdir, stat, access, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { z } from "zod";
import { BoundedRequestStore, requestLimit } from "./request-limits";
import { parseCleanCoreEvidence } from "./clean-core-assessment";
import { localStorage, azureStorage, s3Storage } from "./knowledge/portable-storage";
import { portableUploadUrl, uploadRouter } from "./knowledge/upload-token";
import { sample, validate } from "./reports/engine.mjs";
import { StartKnowledgeUploadBody, RenderWordReportsBody } from "@workspace/api-zod";
import { assertInputBounds } from "./input-bounds";

async function serve(app: Express, action: (base: string) => Promise<void>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  try { await action(`http://127.0.0.1:${(server.address() as any).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

test("bounded fixed-window store recovers and never evicts a live budget on saturation", async () => {
  let now = 1000;
  const store = new BoundedRequestStore(2, () => now);
  store.init({ windowMs: 100 } as any);
  assert.equal((await store.increment("a")).totalHits, 1);
  await store.increment("b");
  assert.equal((await store.increment("c")).totalHits, Number.MAX_SAFE_INTEGER);
  assert.equal((await store.increment("a")).totalHits, 2);
  now += 100;
  assert.equal((await store.increment("c")).totalHits, 1);
  assert.equal((await store.increment("a")).totalHits, 1);
});

test("throttles before identity/body parsing; spoofed forwarded headers cannot reset IP budget", async () => {
  const app = express(); let lookups = 0;
  app.get("/health", (_req, res) => { res.send("ok"); });
  app.use(requestLimit("test", 2, false, 1000));
  app.use((_req, _res, next) => { lookups++; next(); }, express.json());
  app.all("/work", (_req, res) => { res.json({ ok: true }); });
  await serve(app, async base => {
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/work`, { headers: { "X-Forwarded-For": `192.0.2.${i}`, Forwarded: `for=192.0.2.${i}` } })).status, 200);
    const blocked = await fetch(`${base}/work`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.4" }, body: "invalid json" });
    assert.equal(blocked.status, 429); assert(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(lookups, 2);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    await new Promise(r => setTimeout(r, 1100));
    assert.equal((await fetch(`${base}/work`)).status, 200);
  });
});

test("account budgets are isolated and cannot be selected by forwarded headers", async () => {
  const app = express();
  app.use((req, _res, next) => { req.identity = { user: { id: req.path === "/other" ? "other" : "one" } } as any; next(); });
  app.use(requestLimit("test", 1, true));
  app.use((_req, res) => { res.sendStatus(200); });
  await serve(app, async base => {
    assert.equal((await fetch(`${base}/one`)).status, 200);
    assert.equal((await fetch(`${base}/one`, { headers: { "X-Forwarded-For": "198.51.100.1" } })).status, 429);
    assert.equal((await fetch(`${base}/other`)).status, 200);
  });
});

test("production and knowledge fixture identity work is behind the shared ingress limit", async () => {
  const { pool } = await import("@workspace/db");
  const original = pool.query;
  let lookups = 0;
  pool.query = (async () => { lookups++; return { rows: [] }; }) as any;
  try {
    const { default: production } = await import("./app");
    const { knowledgeFixture } = await import("./knowledge/fixture");
    for (const app of [production, knowledgeFixture()]) {
      lookups = 0;
      await serve(app, async base => {
        for (let i = 0; i < 600; i++) {
          const response = await fetch(`${base}/api/clean-core/knowledge`, { headers: { Cookie: `cc_session=${"a".repeat(43)}`, "X-Forwarded-For": `192.0.2.${i % 255}` } });
          assert.equal(response.status, 401); await response.arrayBuffer();
        }
        const blocked = await fetch(`${base}/api/clean-core/knowledge`, { headers: { Cookie: `cc_session=${"a".repeat(43)}` } });
        assert.equal(blocked.status, 429); assert(blocked.headers.get("retry-after"));
        assert.equal(lookups, 600);
        if (app === production) assert.equal((await fetch(`${base}/health`)).status, 200);
      });
    }
  } finally { pool.query = original; }
});

test("production static assets and SPA fallback share a bounded budget", async () => {
  const { productionFrontend, probes } = await import("./runtime");
  const dir = await mkdtemp(join(tmpdir(), "cc-security-spa-"));
  const previous = process.env.CC_STATIC_DIR;
  try {
    await writeFile(join(dir, "index.html"), "<html>safe SPA</html>");
    await writeFile(join(dir, "asset.js"), "/* safe asset */");
    process.env.CC_STATIC_DIR = dir;
    const app = express(); app.use(probes); productionFrontend(app);
    await serve(app, async base => {
      for (let i = 0; i < 600; i++) {
        const response = await fetch(base + (i % 2 ? "/asset.js" : "/nested/spa"), { headers: { Accept: "text/html" } });
        assert.equal(response.status, 200); await response.arrayBuffer();
      }
      for (const path of ["/asset.js", "/nested/spa"]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 429); assert(response.headers.get("retry-after"));
      }
      assert.equal((await fetch(base + "/health")).status, 200);
    });
  } finally {
    if (previous === undefined) delete process.env.CC_STATIC_DIR; else process.env.CC_STATIC_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("evidence XML, text and downstream normalization reject crafted complexity/prototype keys", () => {
  const before = performance.now();
  for (const content of [
    `<item ${"a".repeat(90_000)}=''>x</item>`,
    `<item><objectName>Z</objectName><__proto__>x</__proto__></item>`,
    `<item constructor="x"><objectName>Z</objectName></item>`,
    `<item><objectName>Z</objectName><prototype>x</prototype></item>`,
    '[{"objectName":"Z","__proto__":{"polluted":true}}]',
    'objectName,constructor\nZ,evil',
    "<x>".repeat(65) + "</x>".repeat(65),
    '<!DOCTYPE x [<!ENTITY a "expanded">]><item objectName="Z"/>',
    '<item objectName="Z" finding="unterminated>',
    "Z:high" + " ".repeat(99_000),
    "x".repeat(16_000_001),
    JSON.stringify(Array.from({ length: 20_001 }, () => ({ objectName: "Z" }))),
  ]) assert.throws(() => parseCleanCoreEvidence("atc", content));
  assert(performance.now() - before < 3000, "crafted inputs finish promptly");
  assert.equal(({} as any).polluted, undefined);
  assert.deepEqual(parseCleanCoreEvidence("atc", '<results><item objectName="Z" severity="high"><finding>A &amp; B</finding><unsupported>ignored</unsupported></item></results>'), [{ objectName: "Z", severity: "high", finding: "A & B", source: "atc" }]);
});

test("all portable adapters reject non-binary/empty/oversized values before forwarding or filesystem writes", async () => {
  process.env.PRIVATE_OBJECT_DIR = "/documents/private";
  const dir = await mkdtemp(join(tmpdir(), "cc-security-storage-")); let calls = 0;
  const azure = azureStorage({ getBlockBlobClient() { calls++; return { uploadData: async () => {} }; } } as any);
  const s3 = s3Storage({ send: async () => { calls++; } } as any, "bucket");
  try {
    for (const storage of [localStorage(dir), azure, s3]) {
      for (const bytes of ["abc", [], [1, 2], {}, { length: 1 }, { length: 0, toString: () => "x" }, null, undefined, new Uint8Array([1]), Buffer.alloc(0), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
        await assert.rejects(storage.put("/documents/private/knowledge/test", bytes as any));
      }
    }
    assert.equal(calls, 0); assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("portable HTTP uploads reject wrong media, query tampering, bad capabilities and preserve sealing", async () => {
  const previous = { mode: process.env.CC_KNOWLEDGE_STORAGE, dir: process.env.CC_STORAGE_LOCAL_DIR, root: process.env.PRIVATE_OBJECT_DIR, secret: process.env.SESSION_SECRET };
  const dir = await mkdtemp(join(tmpdir(), "cc-security-upload-"));
  process.env.CC_KNOWLEDGE_STORAGE = "local"; process.env.CC_STORAGE_LOCAL_DIR = dir;
  process.env.PRIVATE_OBJECT_DIR = "/documents/private";
  process.env.SESSION_SECRET = "synthetic-upload-test-secret-not-real-0000";
  const app = express(); app.use("/api/storage-upload", requestLimit("upload", 30), uploadRouter);
  app.use(((err: any, _req: any, res: any, _next: any) => { res.sendStatus(err.type === "entity.too.large" ? 413 : 400); }) as express.ErrorRequestHandler);
  try {
    await serve(app, async base => {
      const url = base + portableUploadUrl("/documents/private/knowledge/test");
      for (const [suffix, type, body] of [
        ["", "application/json", '{"length":1}'], ["", "text/plain", "abc"],
        ["?data=x&data=y", "application/octet-stream", "abc"], ["", "application/octet-stream", ""],
      ]) assert.equal((await fetch(url + suffix, { method: "PUT", headers: { "Content-Type": type }, body })).status, 400);
      assert.equal((await fetch(base + "/api/storage-upload/invalid", { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "abc" })).status, 400);
      assert.equal((await fetch(url, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.alloc(8 * 1024 * 1024 + 1) })).status, 413);
      assert.equal((await fetch(url, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "abc" })).status, 204);
      assert.equal((await fetch(url, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "overwrite" })).status, 400);
      assert.equal((await localStorage(dir).read("/documents/private/knowledge/test")).toString(), "abc");
    });
  } finally {
    for (const [key, value] of Object.entries({ CC_KNOWLEDGE_STORAGE: previous.mode, CC_STORAGE_LOCAL_DIR: previous.dir, PRIVATE_OBJECT_DIR: previous.root, SESSION_SECRET: previous.secret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("DOCX requires the real document root and exact namespace, not comments/suffixes/descendants", async () => {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  for (const mutate of [
    (xml: string) => xml.replace(W, `${W}.attacker.invalid`),
    (xml: string) => `<!-- ${W} --><wrapper>${xml}</wrapper>`,
    (xml: string) => xml.replace(W, "urn:evil").replace("<w:body>", `<w:body xmlns:other="${W}">`),
    (xml: string) => xml.replace("<w:body>", '<w:body xmlns:w="urn:evil">'),
    (xml: string) => xml.replace(W, "urn:evil") + `<!-- ${W} -->`,
  ]) {
    const zip = new PizZip(sample()); zip.file("word/document.xml", mutate(zip.file("word/document.xml")!.asText()));
    await assert.rejects(validate(zip.generate({ type: "nodebuffer", compression: "DEFLATE" })));
  }
  await validate(sample());
});

test("smoke temporary file is private, exclusive, unpredictable and cleaned on success/failure", async () => {
  const modulePath = "../../../deploy/private-temp.mjs";
  const { withPrivateTempFile } = await import(modulePath);
  const directories: string[] = [];
  for (const fail of [false, true]) {
    const promise = withPrivateTempFile(async (handle: any, filename: string, directory: string) => {
      directories.push(directory);
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(filename)).mode & 0o777, 0o600);
      await assert.rejects(open(filename, "wx", 0o600));
      await handle.writeFile("ok");
      if (fail) throw new Error("synthetic failure");
    });
    if (fail) await assert.rejects(promise, /synthetic failure/); else await promise;
    await assert.rejects(access(directories.at(-1)!));
  }
  assert.notEqual(directories[0], directories[1]);
});

test("Zod 4 generated contracts retain strict request validation and reject invalid arrays", () => {
  assert(StartKnowledgeUploadBody.strict().safeParse({ title: "Guide", release: "S4HANA_2025", topics: [], filename: "guide.md", size: 12 }).success);
  assert(!StartKnowledgeUploadBody.strict().safeParse({ title: "Guide", release: "S4HANA_2025", topics: [], filename: "guide.md", size: "12", injected: true }).success);
  assert(!RenderWordReportsBody.strict().safeParse({ templateId: "sample", entities: [] }).success);
  let parsed = 0;
  const result = z.array(z.string().refine(() => { parsed++; return true; })).max(100).safeParse(Array(100_000).fill(null));
  assert(!result.success);
  assert.equal(result.error.issues.length, 1, "patched bounded arrays fail before element validation");
  assert.equal(parsed, 0);
  assert.throws(() => assertInputBounds({ unbounded: Array(100_000).fill(null) }));
  assert.throws(() => assertInputBounds(JSON.parse('{"nested":{"__proto__":true}}')));
});

test("base URL slash trimming remains compatible and bounds excessive configuration", async () => {
  const modulePath = "../../../lib/api-client-react/src/custom-fetch";
  const { customFetch, setBaseUrl } = await import(modulePath);
  const original = globalThis.fetch; let requested: unknown;
  globalThis.fetch = (async (url: unknown) => { requested = url; return new Response("ok"); }) as any;
  try {
    setBaseUrl("https://example.test///"); await customFetch("/path"); assert.equal(requested, "https://example.test/path");
    setBaseUrl("////"); await customFetch("/path"); assert.equal(requested, "/path");
    assert.throws(() => setBaseUrl("x" + "/".repeat(1_000_000)));
  } finally { setBaseUrl(null); globalThis.fetch = original; }
});
