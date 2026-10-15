import { Storage } from "@google-cloud/storage";
import { objectStorageClient } from "../lib/objectStorage";
import { AiError } from "../assessment-ai";
import { portableStorage } from "./portable-storage";
import { portableUploadUrl } from "./upload-token";

// Replit uses the unchanged sidecar client; client-hosted GCS uses workload identity/ADC.
const clientStorage = new Storage();
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export function storageConfigured() { return !!process.env.PRIVATE_OBJECT_DIR; }
function file(path: string) {
  const match = /^\/([^/]+)\/(.+)$/.exec(path);
  if (!match) throw new AiError(503, "Configure PRIVATE_OBJECT_DIR as /private-bucket/prefix. No temporary storage fallback is used.");
  const client = process.env.CC_KNOWLEDGE_STORAGE === "gcs" ? clientStorage : objectStorageClient;
  return client.bucket(match[1]).file(match[2]);
}
export function objectPath(id: string) {
  if (!storageConfigured()) throw new AiError(503, "Private durable document storage is not configured. See docs/knowledge-base.md.");
  return `${process.env.PRIVATE_OBJECT_DIR!.replace(/\/$/, "")}/knowledge/${id}`;
}
export async function uploadUrl(path: string) {
  if (portableStorage()) return portableUploadUrl(path);
  const obj = file(path);
  if (process.env.CC_KNOWLEDGE_STORAGE === "gcs") {
    return (await obj.getSignedUrl({ version: "v4", action: "write", expires: Date.now() + 300_000, contentType: "application/octet-stream" }))[0];
  }
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ bucket_name: obj.bucket.name, object_name: obj.name, method: "PUT", expires_at: new Date(Date.now() + 300_000).toISOString() }),
  });
  if (!response.ok) throw new AiError(503, "Private storage cannot authorize the upload.");
  return ((await response.json()) as { signed_url: string }).signed_url;
}
export async function readObject(path: string) {
  const backend = portableStorage();
  if (backend) return backend.read(path);
  const obj = file(path);
  const [meta] = await obj.getMetadata();
  if (!meta.size || Number(meta.size) > MAX_FILE_BYTES) throw new AiError(413, "Guidance must be 8 MB or smaller.");
  // Pin generation; signed PUT may still be valid. A later overwrite cannot change indexed/served content.
  const generation = String(meta.generation);
  const pinned = obj.bucket.file(obj.name, { generation });
  const buffers: Buffer[] = [];
  let size = 0;
  const stream = pinned.createReadStream();
  for await (const value of stream) {
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > MAX_FILE_BYTES) { stream.destroy(); throw new AiError(413, "Guidance exceeds 8 MB."); }
    buffers.push(chunk);
  }
  return Buffer.concat(buffers);
}
export async function saveSealed(path: string, bytes: Buffer) {
  const backend = portableStorage();
  if (backend) return backend.put(path, bytes);
  await file(path).save(bytes, { resumable: false, contentType: "application/octet-stream", preconditionOpts: { ifGenerationMatch: 0 } });
}
export async function removeObject(path: string) {
  const backend = portableStorage();
  if (backend) return backend.remove(path);
  await file(path).delete({ ignoreNotFound: true });
}

export async function probeStorage() {
  if (!storageConfigured()) return;
  const backend = portableStorage();
  if (backend) return backend.probe();
  const root = file(objectPath("placeholder"));
  await root.bucket.getFiles({ prefix: root.name, maxResults: 1, autoPaginate: false });
}

export interface CleanupObject { path: string; generation: string; updatedAt: number }
export async function listCleanupObjects(cursor?: string) {
  const backend = portableStorage();
  if (backend) {
    const prefix = objectPath("");
    const page = await backend.list(prefix, cursor);
    return { ...page, objects: page.objects.filter(o => /^[0-9a-f-]{36}(-sealed)?$/.test(o.path.slice(prefix.length))) };
  }
  const root = file(objectPath("placeholder"));
  const prefix = root.name.slice(0, -"placeholder".length);
  const [files, next] = await root.bucket.getFiles({
    prefix, maxResults: 50, autoPaginate: false, pageToken: cursor,
  });
  return {
    objects: files.filter(f => /^[0-9a-f-]{36}(-sealed)?$/.test(f.name.slice(prefix.length))).map(f => ({
      path: `/${root.bucket.name}/${f.name}`,
      generation: String(f.metadata.generation ?? ""),
      updatedAt: Date.parse(f.metadata.updated ?? ""),
    })),
    cursor: next?.pageToken ?? null,
  };
}
export async function removeCleanupObject(object: CleanupObject) {
  if (!object.generation) throw new Error("Missing storage version");
  const backend = portableStorage();
  if (backend) return backend.remove(object.path, object.generation);
  // Never delete a newer generation written after enumeration.
  await file(object.path).delete({ ignoreNotFound: true, ifGenerationMatch: object.generation });
}
