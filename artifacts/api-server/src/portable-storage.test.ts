import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStorage, s3Storage, storageKey } from "./knowledge/portable-storage";

process.env.PRIVATE_OBJECT_DIR = "/documents/private";
test("local storage: create-only, pinned read, bounded enumeration and conditional deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-storage-test-"));
  const store = localStorage(dir), path = "/documents/private/knowledge/one";
  try {
    await store.put(path, Buffer.from("original"));
    await assert.rejects(store.put(path, Buffer.from("replacement")));
    assert.equal((await store.read(path)).toString(), "original");
    const page = await store.list("/documents/private/knowledge/");
    assert.equal(page.objects.length, 1);
    await assert.rejects(store.remove(path, "stale"));
    await store.remove(path, page.objects[0].generation);
    await assert.rejects(store.read(path));
    for (let i = 0; i < 53; i++) await store.put(`${path}${i}`, Buffer.from("x"));
    const first = await store.list("/documents/private/knowledge/");
    assert.equal(first.objects.length, 50);
    assert.ok(first.cursor);
    assert.equal((await store.list("/documents/private/knowledge/", first.cursor!)).objects.length, 3);
    assert.throws(() => storageKey("/documents/private/../escape"));
    assert.throws(() => storageKey("/other/path"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("S3 contract uses create-only writes and native version IDs, not GCS generations", async () => {
  const commands: any[] = [];
  const client: any = { async send(command: any) {
    commands.push(command);
    switch (command.constructor.name) {
      case "GetBucketVersioningCommand": return { Status: "Enabled" };
      case "HeadObjectCommand": return { VersionId: "version-1", ETag: '"etag"', ContentLength: 3, LastModified: new Date(1000) };
      case "GetObjectCommand": return { Body: (async function* () { yield Buffer.from("abc"); })() };
      case "ListObjectsV2Command": return { Contents: [{ Key: "documents/private/knowledge/id" }], NextContinuationToken: "next" };
      default: return {};
    }
  } };
  const storage = s3Storage(client, "bucket"), path = "/documents/private/knowledge/id";
  await storage.probe();
  await storage.put(path, Buffer.from("abc"));
  assert.equal(commands.at(-1).input.IfNoneMatch, "*");
  assert.equal((await storage.read(path)).toString(), "abc");
  assert.equal(commands.at(-1).input.VersionId, "version-1");
  assert.equal(commands.at(-1).input.IfMatch, '"etag"');
  const page = await storage.list("/documents/private/knowledge/", "previous");
  assert.equal(page.objects[0].generation, "version-1");
  assert.equal(page.cursor, "next");
  const list = commands.find(c => c.constructor.name === "ListObjectsV2Command");
  assert.equal(list.input.MaxKeys, 50);
  assert.equal(list.input.ContinuationToken, "previous");
  await storage.remove(path, page.objects[0].generation);
  assert.equal(commands.at(-1).input.VersionId, "version-1");
});
test("S3 fails closed on unversioned buckets and cloud errors", async () => {
  const unversioned: any = { send: async () => ({}) };
  await assert.rejects(s3Storage(unversioned, "bucket").probe());
  await assert.rejects(s3Storage(unversioned, "bucket").read("/documents/private/knowledge/id"));
  const failure: any = { send: async () => { throw new Error("cloud failure"); } };
  await assert.rejects(s3Storage(failure, "bucket").put("/documents/private/knowledge/id", Buffer.from("x")), /cloud failure/);
});
