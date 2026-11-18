import { createHash } from "node:crypto";
import { UploadSharedSourceBody } from "@workspace/api-zod";
import type { PoolClient } from "@workspace/db";
import type { Identity } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { removeObject } from "../knowledge/storage";
import { storePrivate } from "./files";
import { editable, entity, event, expected, revision, transaction } from "./service";

export const MAX_UPLOADED_SOURCE_BYTES = 256_000;

export function decodeSourceUpload(input: unknown) {
  const body = UploadSharedSourceBody.strict().parse(input);
  if (body.fileName !== body.fileName.trim() ||
    !/^[^/\\\u0000-\u001f\u007f]+\.(txt|abap)$/i.test(body.fileName)) {
    throw new AiError(400, "Choose a .txt or .abap filename without folders or control characters (180 characters maximum).");
  }
  const bytes = Buffer.from(body.fileBase64, "base64");
  if (bytes.toString("base64") !== body.fileBase64) throw new AiError(400, "The source file encoding is invalid. Select the original file again.");
  if (bytes.length > MAX_UPLOADED_SOURCE_BYTES) throw new AiError(413, "Source files must be 256,000 bytes or smaller.");
  if (!bytes.length || bytes.some(b => b === 127 || (b < 32 && b !== 9 && b !== 10 && b !== 13))) {
    throw new AiError(400, "Source must be non-empty UTF-8 text, not binary data.");
  }
  let code: string;
  try { code = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AiError(400, "Source must be UTF-8 text. Save the file with UTF-8 encoding and try again."); }
  if (!code.trim()) throw new AiError(400, "The source file is empty.");
  return { body, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function retainUploadSources(existing: any[], fileName: string) {
  const retained = existing.filter(s => !(s.kind === "upload" && s.path === fileName));
  if (retained.length >= 10) throw new AiError(400, "At most ten source files per item, including GitHub files. Replace an uploaded file with the same filename or use fewer files.");
  return retained;
}

/** Authorization/version checks bracket private staging; nothing is executed or sent to AI. */
export async function uploadSourceFile(identity: Identity, id: string, input: unknown) {
  const { body, bytes, sha256 } = decodeSourceUpload(input);
  const authorize = async (c: Pick<PoolClient, "query">) => {
    const result = await entity(c, identity, id);
    if (!editable(result.user, result.assessment, result.row).developer ||
      !result.user.permissions.includes("evidence")) {
      throw new AiError(403, "Only an editor with Classify and Upload evidence permissions can attach source.");
    }
    expected(result.row, body.expectedVersion);
    retainUploadSources(result.row.sources, body.fileName);
    return result;
  };
  await transaction(authorize);
  const objectPath = await storePrivate("source", bytes);
  try {
    const updated = await transaction(async c => {
      const { row } = await authorize(c);
      const snapshot = {
        kind: "upload", path: body.fileName, sha256, byteLength: bytes.length,
        uploadedAt: new Date().toISOString(), uploadedBy: identity.user.id, objectPath,
      };
      const sources = [...retainUploadSources(row.sources, body.fileName), snapshot];
      const next = (await c.query(`UPDATE cc_assessment_entities SET sources=$2,version=version+1,
        state='Draft',updated_at=now() WHERE id=$1 RETURNING *`, [id, JSON.stringify(sources)])).rows[0];
      await revision(c, identity, next, "Uploaded source snapshot");
      await event(c, identity, next, "source uploaded");
      return next;
    });
    return { entity: updated, proposal: null };
  } catch (error) {
    // Old versions keep their immutable files. Only a failed new stage is removed.
    await removeObject(objectPath).catch(() => undefined);
    throw error;
  }
}
