import { timingSafeEqual } from "node:crypto";
import { Router, raw } from "express";
import { storageKey } from "./portable-storage";
import { MAX_FILE_BYTES, saveSealed } from "./storage";
import { uploadSignature } from "./upload-capability";
export { portableUploadUrl } from "./upload-capability";

export const uploadRouter = Router();
uploadRouter.put("/:token", raw({ type: "application/octet-stream", limit: MAX_FILE_BYTES }), async (req, res) => {
  try {
    if (typeof req.params.token !== "string" || Object.keys(req.query).length || !req.is("application/octet-stream")) throw new Error();
    const token = req.params.token;
    if (token.length > 4096) throw new Error();
    const [payload, supplied, extra] = token.split(".");
    const expected = uploadSignature(payload);
    if (extra || !supplied || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error();
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || typeof value.path !== "string" || typeof value.expires !== "number") throw new Error();
    storageKey(value.path);
    if (!Number.isFinite(value.expires) || value.expires < Date.now() || value.expires > Date.now() + 300_000) throw new Error();
    const bytes: unknown = req.body;
    if (typeof bytes !== "object" || bytes === null || !Buffer.isBuffer(bytes)) throw new Error();
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) throw new Error();
    // Shared create-only writer also validates the Buffer and size before
    // contacting GCS, Replit App Storage, or a portable backend.
    await saveSealed(value.path, bytes);
    res.sendStatus(204);
  } catch { res.status(400).json({ message: "Upload expired, already used, or unavailable. Start a new upload." }); }
});
