import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetBucketVersioningCommand } from "@aws-sdk/client-s3";
import { BlobServiceClient, type BlobItem } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { mkdir, open, link, unlink, readFile, opendir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

// New backends use create-only staging as well as sealing. A signed upload
// can never replace bytes after validation. No backend silently falls back.
export interface StoredObject { path: string; generation: string; updatedAt: number }
export interface PortableStorage {
  read(path: string): Promise<Buffer>;
  put(path: string, bytes: Buffer): Promise<void>;
  remove(path: string, version?: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ objects: StoredObject[]; cursor: string | null }>;
  probe(): Promise<void>;
}
const MAX = 8 * 1024 * 1024;
export function storageKey(path: string) {
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (!root || !path.startsWith(`${root}/`) || path.includes("\\") || path.split("/").some(p => p === ".." || p === ".")) throw new Error("Invalid storage path");
  return path.slice(1);
}
async function bounded(stream: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX) throw new Error("Document exceeds 8 MB");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function httpsEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Storage endpoint must use HTTPS");
  return url.toString();
}
export function s3Storage(client = new S3Client({
  region: process.env.CC_S3_REGION,
  endpoint: process.env.CC_S3_ENDPOINT ? httpsEndpoint(process.env.CC_S3_ENDPOINT) : undefined,
  maxAttempts: 2,
}), bucket = process.env.CC_S3_BUCKET!): PortableStorage {
  const send = (command: any) => client.send(command, { abortSignal: AbortSignal.timeout(4000) }) as Promise<any>;
  return {
    async probe() {
      const result = await send(new GetBucketVersioningCommand({ Bucket: bucket }));
      if (result.Status !== "Enabled") throw new Error("S3 bucket versioning must be enabled");
    },
    async read(path) {
      const Key = storageKey(path);
      const meta = await send(new HeadObjectCommand({ Bucket: bucket, Key }));
      if (!meta.ETag || !meta.VersionId || meta.VersionId === "null" || meta.ContentLength > MAX) throw new Error("Invalid object size/version");
      const result = await send(new GetObjectCommand({ Bucket: bucket, Key, IfMatch: meta.ETag, VersionId: meta.VersionId }));
      return bounded(result.Body);
    },
    async put(path, bytes) {
      if (bytes.length > MAX) throw new Error("Document exceeds 8 MB");
      await send(new PutObjectCommand({ Bucket: bucket, Key: storageKey(path), Body: bytes, IfNoneMatch: "*", ContentType: "application/octet-stream" }));
    },
    async remove(path, version) {
      if (!version) {
        try {
          const meta = await send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey(path) }));
          if (!meta.VersionId || meta.VersionId === "null") throw new Error("S3 versioning required");
          version = meta.VersionId;
        } catch (e: any) { if (e.$metadata?.httpStatusCode === 404) return; throw e; }
      }
      // Delete exactly the observed version, never a newer writer's version.
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey(path), VersionId: version }));
    },
    async list(prefix, cursor) {
      const page = await send(new ListObjectsV2Command({ Bucket: bucket, Prefix: storageKey(prefix), MaxKeys: 50, ContinuationToken: cursor }));
      const objects: StoredObject[] = [];
      for (const o of page.Contents ?? []) {
        try {
          const meta = await send(new HeadObjectCommand({ Bucket: bucket, Key: o.Key }));
          if (!meta.VersionId || meta.VersionId === "null") throw new Error("S3 versioning required");
          objects.push({ path: `/${o.Key}`, generation: meta.VersionId, updatedAt: meta.LastModified?.getTime() ?? NaN });
        } catch (e: any) { if (e.$metadata?.httpStatusCode !== 404) throw e; }
      }
      return { objects, cursor: page.NextContinuationToken ?? null };
    },
  };
}
function azureContainer() {
  const service = new BlobServiceClient(httpsEndpoint(process.env.CC_AZURE_STORAGE_URL!), new DefaultAzureCredential(), { retryOptions: { maxTries: 2, tryTimeoutInMs: 4000 } });
  return service.getContainerClient(process.env.CC_AZURE_STORAGE_CONTAINER!);
}
export function azureStorage(container = azureContainer()): PortableStorage {
  const blob = (path: string) => container.getBlockBlobClient(storageKey(path));
  const options = () => ({ abortSignal: AbortSignal.timeout(4000) });
  return {
    async probe() { await container.getProperties(options()); },
    async put(path, bytes) {
      if (bytes.length > MAX) throw new Error("Document exceeds 8 MB");
      await blob(path).uploadData(bytes, { ...options(), conditions: { ifNoneMatch: "*" } });
    },
    async read(path) {
      const b = blob(path), meta = await b.getProperties(options());
      if (!meta.etag || (meta.contentLength ?? Infinity) > MAX) throw new Error("Invalid object size/version");
      const result = await b.download(0, undefined, { ...options(), conditions: { ifMatch: meta.etag } });
      return bounded(result.readableStreamBody as AsyncIterable<Uint8Array>);
    },
    async remove(path, version) { await blob(path).deleteIfExists({ ...options(), conditions: version ? { ifMatch: version } : undefined }); },
    async list(prefix, cursor) {
      const page = await container.listBlobsFlat({ prefix: storageKey(prefix), ...options() }).byPage({ maxPageSize: 50, continuationToken: cursor }).next();
      return { objects: (page.value?.segment.blobItems ?? []).map((o: BlobItem) => ({ path: `/${o.name}`, generation: o.properties.etag ?? "", updatedAt: o.properties.lastModified?.getTime() ?? NaN })), cursor: page.value?.continuationToken || null };
    },
  };
}
export function localStorage(root = process.env.CC_STORAGE_LOCAL_DIR!, now = Date.now): PortableStorage {
  if (!root || !root.startsWith("/")) throw new Error("Local storage needs an absolute persistent volume path");
  const dir = resolve(root);
  const filename = (path: string) => join(dir, Buffer.from(storageKey(path)).toString("base64url"));
  // One process/replica only. Serialize mutation/read pairs to prevent ABA deletes.
  let pending = Promise.resolve();
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const result = pending.then(fn); pending = result.then(() => undefined, () => undefined); return result;
  }
  async function record(path: string) { return JSON.parse(await readFile(filename(path), "utf8")); }
  return {
    async probe() { await access(dir); },
    read: path => locked(async () => Buffer.from((await record(path)).data, "base64")),
    put: (path, bytes) => locked(async () => {
      if (bytes.length > MAX) throw new Error("Document exceeds 8 MB");
      await mkdir(dir, { recursive: true });
      // Same-volume temporary file is required for atomic link; private mode,
      // never visible as an object. /tmp cannot be atomically linked across volumes.
      const temp = join(dir, `.pending-${randomUUID()}`);
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ path, generation: randomUUID(), updatedAt: now(), data: bytes.toString("base64") }));
        await handle.sync(); await handle.close();
        await link(temp, filename(path)); // atomic create-only publication
      } finally { await handle.close().catch(() => undefined); await unlink(temp).catch(() => undefined); }
    }),
    remove: (path, version) => locked(async () => {
      try {
        if (version && (await record(path)).generation !== version) throw new Error("Storage version changed");
        await unlink(filename(path));
      } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    }),
    async list(prefix, cursor = "") {
      // Bounded memory even for large volumes; lexical paging independent of readdir order.
      const names: string[] = [];
      for await (const entry of await opendir(dir)) {
        if (!entry.isFile() || entry.name.startsWith(".") || entry.name <= cursor) continue;
        const path = `/${Buffer.from(entry.name, "base64url").toString()}`;
        if (!path.startsWith(prefix)) continue;
        names.push(entry.name); names.sort(); if (names.length > 51) names.pop();
      }
      const objects: StoredObject[] = [];
      for (const name of names.slice(0, 50)) {
        try { const { path, generation, updatedAt } = JSON.parse(await readFile(join(dir, name), "utf8")); objects.push({ path, generation, updatedAt }); }
        catch (e: any) { if (e.code !== "ENOENT") throw e; }
      }
      return { objects, cursor: names.length > 50 ? names[49] : null };
    },
  };
}
let backend: PortableStorage | undefined;
export function portableStorage(): PortableStorage | undefined {
  const mode = process.env.CC_KNOWLEDGE_STORAGE;
  if (!mode || mode === "gcs" || mode === "replit") return;
  if (backend) return backend;
  if (mode === "s3" && process.env.CC_S3_BUCKET && process.env.CC_S3_REGION) return backend = s3Storage();
  if (mode === "azure" && process.env.CC_AZURE_STORAGE_URL && process.env.CC_AZURE_STORAGE_CONTAINER) return backend = azureStorage();
  if (mode === "local") return backend = localStorage();
  throw new Error("Invalid storage backend configuration");
}
