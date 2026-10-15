import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool, type PoolClient } from "@workspace/db";
import { localStorage, s3Storage, azureStorage, type PortableStorage } from "./knowledge/portable-storage";
import { runCleanup, CLEANUP_GRACE_MS } from "./knowledge/cleanup";
import { libraryTransaction } from "./knowledge/service";

const old = Date.now() - 2 * CLEANUP_GRACE_MS;
// These SDK doubles exercise the real adapters, including native deletion
// conditions. Real cloud connectivity remains a client-approved separate check.
function cloudStore(kind: "s3" | "azure") {
  const records = new Map<string, { data: Buffer; version: string; date: Date }>();
  const deletes: string[] = [];
  function put(key: string, data: Buffer, conditional: boolean) {
    assert(conditional);
    if (records.has(key)) throw new Error("precondition");
    records.set(key, { data, version: kind === "s3" ? `S3.${randomUUID()}` : `"0x${randomUUID()}"`, date: new Date(old) });
  }
  function del(key: string, version: string) {
    const record = records.get(key);
    if (!record || record.version !== version) throw new Error("precondition");
    deletes.push(version); records.delete(key);
  }
  let storage: PortableStorage;
  if (kind === "s3") {
    storage = s3Storage({ async send(command: any) {
      const i = command.input, row = records.get(i.Key);
      switch (command.constructor.name) {
        case "PutObjectCommand": put(i.Key, i.Body, i.IfNoneMatch === "*"); return {};
        case "ListObjectsV2Command": {
          assert.equal(i.MaxKeys, 50);
          const keys = [...records.keys()].filter(k => k.startsWith(i.Prefix));
          return { Contents: keys.slice(0, 50).map(Key => ({ Key })) };
        }
        case "HeadObjectCommand":
          if (!row) throw Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } });
          return { VersionId: row.version, ETag: '"etag"', LastModified: row.date, ContentLength: row.data.length };
        case "DeleteObjectCommand": del(i.Key, i.VersionId); return {};
        default: throw new Error(`Unexpected ${command.constructor.name}`);
      }
    } } as any, "test-bucket");
  } else {
    storage = azureStorage({
      getBlockBlobClient(key: string) {
        return {
          async uploadData(data: Buffer, options: any) { put(key, data, options.conditions.ifNoneMatch === "*"); },
          async deleteIfExists(options: any) { del(key, options.conditions.ifMatch); },
        };
      },
      listBlobsFlat(options: any) {
        return { byPage({ maxPageSize }: any) {
          assert.equal(maxPageSize, 50);
          return { async next() {
            return { value: { segment: { blobItems: [...records.entries()].filter(([k]) => k.startsWith(options.prefix)).slice(0, 50).map(([name, row]) => ({
              name, properties: { etag: row.version, lastModified: row.date },
            })) } } };
          } };
        } };
      },
    } as any);
  }
  return { storage, records, deletes };
}

for (const backend of ["local", "s3", "azure"] as const) {
  test(`${backend}: expired registrations reclaim native-version objects; references and replaced versions survive`, {
    skip: process.env.CC_TEST_KNOWLEDGE !== "true",
  }, async () => {
    process.env.PRIVATE_OBJECT_DIR = "/documents/private";
    const dir = await mkdtemp(join(tmpdir(), "cc-orphans-"));
    const cloud = backend === "local" ? undefined : cloudStore(backend);
    const storage = cloud?.storage ?? localStorage(dir, () => old);
    const schema = `portable_cleanup_${randomUUID().replaceAll("-", "")}`;
    const transaction = <T>(fn: (c: PoolClient) => Promise<T>) => libraryTransaction(async c => {
      await c.query(`SET LOCAL search_path TO ${schema}`);
      return fn(c);
    });
    const prefix = "/documents/private/knowledge/";
    const referenced = prefix + randomUUID();
    const abandoned = Array.from({ length: 26 }, () => prefix + randomUUID());
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      await transaction(async c => {
        await c.query(`CREATE TABLE cc_knowledge(id uuid PRIMARY KEY,status text,object_path text,error text,updated_at timestamptz);
          CREATE TABLE cc_knowledge_cleanup(singleton boolean PRIMARY KEY,cursor text,last_run timestamptz,report jsonb);
          INSERT INTO cc_knowledge_cleanup(singleton) VALUES(true)`);
        for (const path of [referenced, ...abandoned]) {
          await storage.put(path, Buffer.from("private upload"));
          await c.query("INSERT INTO cc_knowledge VALUES($1,$2,$3,NULL,$4)", [
            path.slice(prefix.length), path === referenced ? "ready" : "awaiting-upload", path, new Date(old),
          ]);
        }
      });
      const adapter = {
        list: (cursor?: string) => storage.list(prefix, cursor),
        remove: (o: { path: string; generation: string }) => storage.remove(o.path, o.generation),
      };
      const dry = await runCleanup(true, undefined, false, adapter, transaction);
      assert.equal(dry?.candidates, 25);
      assert.equal((await storage.list(prefix)).objects.length, 27);
      const first = await runCleanup(false, undefined, false, adapter, transaction);
      assert.equal(first?.expiredUploads, 25);
      assert.equal(first?.deleted, 25);
      assert.equal(first?.protected, 2);
      const second = await runCleanup(false, undefined, false, adapter, transaction);
      assert.equal(second?.deleted, 1);
      const remaining = (await storage.list(prefix)).objects;
      assert.deepEqual(remaining.map(o => o.path), [referenced]);
      assert.equal((await transaction(c => c.query("SELECT count(*) FROM cc_knowledge WHERE status='deleted' AND object_path IS NULL"))).rows[0].count, "26");
      if (backend === "local") assert.equal((await readdir(dir)).length, 1, "abandoned uploads must release disk files");
      // Simulate an object changed after enumeration. A stale native token
      // must fail safely rather than deleting a newer object.
      await storage.remove(referenced, remaining[0].generation);
      await storage.put(referenced, Buffer.from("new bytes"));
      await assert.rejects(storage.remove(referenced, remaining[0].generation));
      assert.equal((await storage.list(prefix)).objects.length, 1);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await rm(dir, { recursive: true, force: true });
    }
  });
}
