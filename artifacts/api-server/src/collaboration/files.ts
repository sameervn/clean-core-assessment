import { randomUUID } from "node:crypto";
import { AiError } from "../assessment-ai";
import { saveSealed, storageConfigured } from "../knowledge/storage";

export async function storePrivate(category: string, bytes: Buffer) {
  if (!storageConfigured()) throw new AiError(503, "Configure durable private file storage before sharing source or approved reports.");
  if (bytes.length > 8_000_000) throw new AiError(413, "Private assessment file exceeds 8 MB.");
  const path = `${process.env.PRIVATE_OBJECT_DIR!.replace(/\/$/, "")}/assessments/${category}/${randomUUID()}`;
  await saveSealed(path, bytes);
  return path;
}
