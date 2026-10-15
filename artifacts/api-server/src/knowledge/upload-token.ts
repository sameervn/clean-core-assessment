import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, raw } from "express";
import { portableStorage, storageKey } from "./portable-storage";

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Portable uploads need SESSION_SECRET of at least 32 characters");
  return createHmac("sha256", secret).update(`document-upload:${payload}`).digest("base64url");
}
export function portableUploadUrl(path: string) {
  storageKey(path);
  const payload = Buffer.from(JSON.stringify({ path, expires: Date.now() + 300_000 })).toString("base64url");
  return `/api/storage-upload/${payload}.${signature(payload)}`;
}
export const uploadRouter = Router();
uploadRouter.put("/:token", raw({ type: "application/octet-stream", limit: 8 * 1024 * 1024 }), async (req, res) => {
  try {
    const token = String(req.params.token);
    if (token.length > 4096) throw new Error();
    const [payload, supplied, extra] = token.split(".");
    const expected = signature(payload);
    if (extra || !supplied || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error();
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!Number.isFinite(value.expires) || value.expires < Date.now() || value.expires > Date.now() + 300_000) throw new Error();
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error();
    const storage = portableStorage();
    if (!storage) throw new Error();
    await storage.put(value.path, req.body);
    res.sendStatus(204);
  } catch { res.status(400).json({ message: "Upload expired, already used, or unavailable. Start a new upload." }); }
});
