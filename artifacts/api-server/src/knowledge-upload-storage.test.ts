import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import express from "express";
import { File } from "@google-cloud/storage";
import { MAX_FILE_BYTES, saveSealed, uploadUrl } from "./knowledge/storage";
import { uploadRouter } from "./knowledge/upload-token";

// HTTP-level regressions with the cloud write boundary stubbed. No cloud
// credentials, database or real private objects are needed.
for (const mode of ["gcs", "replit", undefined]) {
  test(`${mode ?? "default Replit"} uploads are bounded before storage and atomically create-only`, async t => {
    const previous = {
      CC_KNOWLEDGE_STORAGE: process.env.CC_KNOWLEDGE_STORAGE,
      PRIVATE_OBJECT_DIR: process.env.PRIVATE_OBJECT_DIR,
      SESSION_SECRET: process.env.SESSION_SECRET,
    };
    if (mode) process.env.CC_KNOWLEDGE_STORAGE = mode;
    else delete process.env.CC_KNOWLEDGE_STORAGE;
    process.env.PRIVATE_OBJECT_DIR = "/synthetic-bucket/private";
    process.env.SESSION_SECRET = "synthetic-upload-regression-secret-0000";
    const objects = new Map<string, Buffer>();
    let writes = 0;
    t.mock.method(File.prototype, "getSignedUrl", () => {
      assert.fail("Knowledge uploads must not issue direct storage-write URLs");
    });
    t.mock.method(File.prototype, "save", async function (this: File, data: Buffer, options: any) {
      writes++;
      assert.equal(options.resumable, false);
      assert.equal(options.contentType, "application/octet-stream");
      assert.deepEqual(options.preconditionOpts, { ifGenerationMatch: 0 });
      assert(data.length > 0 && data.length <= MAX_FILE_BYTES);
      const key = `${this.bucket.name}/${this.name}`;
      // Model the atomic cloud generation precondition, including concurrent PUTs.
      if (objects.has(key)) throw Object.assign(new Error("Precondition failed"), { code: 412 });
      objects.set(key, Buffer.from(data));
    } as any);

    const app = express();
    app.use("/api/storage-upload", uploadRouter);
    app.use(((err, _req, res, _next) => {
      res.sendStatus(err.type === "entity.too.large" ? 413 : 400);
    }) as express.ErrorRequestHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const put = (url: string, body: Buffer | string) => fetch(base + url, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body,
    });
    // No Content-Length: verify the raw parser bounds actual received bytes.
    const chunkedPut = (url: string, chunks: Buffer[]) => new Promise<number>((resolve, reject) => {
      const req = request(base + url, { method: "PUT", headers: { "Content-Type": "application/octet-stream" } }, res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      });
      req.on("error", reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
    try {
      const path = "/synthetic-bucket/private/knowledge/bounded";
      const url = await uploadUrl(path);
      assert.match(url, /^\/api\/storage-upload\//);
      assert.equal((await put(url, Buffer.alloc(MAX_FILE_BYTES + 1))).status, 413);
      assert.equal(writes, 0);
      assert.equal(await chunkedPut(url, [Buffer.alloc(MAX_FILE_BYTES), Buffer.from("x")]), 413);
      assert.equal(writes, 0);
      assert.equal(objects.size, 0);
      assert.equal((await put(url, "")).status, 400);
      assert.equal((await put(url + "tampered", "x")).status, 400);
      assert.equal(writes, 0);

      assert.equal(await chunkedPut(url, [Buffer.alloc(MAX_FILE_BYTES / 2, 65), Buffer.alloc(MAX_FILE_BYTES / 2, 65)]), 204);
      const stored = objects.get("synthetic-bucket/private/knowledge/bounded")!;
      assert.equal(stored.length, MAX_FILE_BYTES);
      assert.equal((await put(url, "replacement")).status, 400);
      assert.deepEqual(objects.get("synthetic-bucket/private/knowledge/bounded"), stored);

      const concurrent = await uploadUrl("/synthetic-bucket/private/knowledge/concurrent");
      const responses = await Promise.all([put(concurrent, "first"), put(concurrent, "second")]);
      assert.deepEqual(responses.map(r => r.status).sort(), [204, 400]);
      assert(["first", "second"].includes(objects.get("synthetic-bucket/private/knowledge/concurrent")!.toString()));
      const before = writes;
      await assert.rejects(saveSealed(path, Buffer.alloc(MAX_FILE_BYTES + 1)), /1 byte to 8 MB/);
      assert.equal(writes, before);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
}
