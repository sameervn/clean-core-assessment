export type KnowledgeStatus = "awaiting-upload" | "processing" | "ready" | "failed";
export interface KnowledgeDocument {
  id: string; title: string; release: string; topics: string[]; version: number; ownerId: string;
  status: KnowledgeStatus; error: string | null; filename: string; createdAt: string;
}
export interface KnowledgePassage { section: string; text: string }
export interface KnowledgeDetail extends KnowledgeDocument { passages: KnowledgePassage[]; canManage: boolean }
export interface KnowledgeList { documents: KnowledgeDocument[]; configured: boolean; message: string }

export const KNOWLEDGE_MAX_BYTES = 8 * 1024 * 1024;
export const KNOWLEDGE_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
export const KNOWLEDGE_RELEASES = ["S4HANA_2025", "S4HANA_2023", "S4HANA_2022", "general"];

export function parseTopics(raw: string): string[] {
  const seen = new Set<string>();
  return raw.split(",").map(t => t.trim()).filter(t => t && !seen.has(t.toLowerCase()) && (seen.add(t.toLowerCase()), true));
}

export function validateKnowledgeUpload(input: { title: string; release: string; topics: string[]; file: { name: string; size: number } | null }): string | null {
  const title = input.title.trim();
  if (!title) return "Title is required.";
  if (title.length > 200) return "Title must be 200 characters or fewer.";
  const release = input.release.trim();
  if (!release) return "Release is required.";
  if (release.length > 50) return "Release must be 50 characters or fewer.";
  if (input.topics.length > 8) return "Use at most 8 topics.";
  if (input.topics.some(t => t.length > 40)) return "Each topic must be 40 characters or fewer.";
  if (!input.file) return "Choose a file to upload.";
  const name = input.file.name.toLowerCase();
  if (!KNOWLEDGE_EXTENSIONS.some(e => name.endsWith(e))) return "Only PDF, DOCX, TXT and MD files are accepted.";
  if (input.file.size <= 0) return "The file is empty.";
  if (input.file.size > KNOWLEDGE_MAX_BYTES) return "Files must be 8 MB or smaller.";
  return null;
}

/** Direct PUT to an external storage URL. No app credentials or CSRF are attached. */
export function putFileWithProgress(url: string, file: Blob, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`File transfer to storage failed (HTTP ${xhr.status}). The previous version, if any, is unchanged.`));
    xhr.onerror = () => reject(new Error("File transfer to storage failed (network error). The previous version, if any, is unchanged."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
}
