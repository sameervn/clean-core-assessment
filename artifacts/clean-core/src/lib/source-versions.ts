import { apiFetch } from "./api";
import type { AiNarratives } from "./ai-narratives";

/** Advisory only: neither a stalled request nor a stalled body may block exports. */
export async function exportSourceVersions(
  notes: AiNarratives,
  request: typeof apiFetch = apiFetch,
  deadlineMs = 2000,
): Promise<Record<string, number> | undefined> {
  if (!Object.values(notes).some(note => note.sources?.length)) return undefined;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>(resolve => {
    timer = setTimeout(() => { abort.abort(); resolve(undefined); }, deadlineMs);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await request("/api/clean-core/knowledge", { signal: abort.signal });
        if (!response.ok) return undefined;
        const library = await response.json();
        if (!Array.isArray(library.documents)) return undefined;
        return Object.fromEntries(library.documents.filter((d: any) => d.status === "ready").map((d: any) => [d.id, d.version]));
      })(),
    ]);
  } catch { return undefined; }
  finally { clearTimeout(timer); abort.abort(); }
}
