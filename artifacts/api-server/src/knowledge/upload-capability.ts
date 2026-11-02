import { createHmac } from "node:crypto";
import { storageKey } from "./portable-storage";

export function uploadSignature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Knowledge uploads need SESSION_SECRET of at least 32 characters");
  return createHmac("sha256", secret).update(`document-upload:${payload}`).digest("base64url");
}

export function portableUploadUrl(path: string) {
  storageKey(path);
  const payload = Buffer.from(JSON.stringify({ path, expires: Date.now() + 300_000 })).toString("base64url");
  return `/api/storage-upload/${payload}.${uploadSignature(payload)}`;
}
