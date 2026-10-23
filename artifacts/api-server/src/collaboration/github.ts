import { createHash } from "node:crypto";
import { AiError } from "../assessment-ai";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export function githubConfig(env: Record<string, string | undefined> = process.env) {
  const repositories = (env.CC_GITHUB_REPOSITORIES ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!env.CC_GITHUB_TOKEN || !repositories.length || repositories.length > 100 || repositories.some(r => !repoPattern.test(r))) return null;
  return { token: env.CC_GITHUB_TOKEN, repositories };
}
export function allowedRepository(repository: string, config: NonNullable<ReturnType<typeof githubConfig>>) {
  if (!repoPattern.test(repository) || !config.repositories.includes(repository)) throw new AiError(403, "Repository is not in the administrator-approved allowlist.");
}
export async function githubJson(path: string, config: NonNullable<ReturnType<typeof githubConfig>>, request: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await request(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new AiError(503, "GitHub could not be reached. No assessment was changed."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiError(response.status === 404 ? 404 : response.status === 401 || response.status === 403 ? 403 : response.status === 429 ? 429 : 503,
      response.status === 404 ? "Repository, ref or file was not found." : response.status === 401 || response.status === 403 ? "GitHub access was denied or revoked. Ask your administrator to check read-only repository access and rate limits." : "GitHub is unavailable or rate-limited. Retry later.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AiError(503, "GitHub returned an empty response.");
  let size = 0; const chunks: Buffer[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) { await reader.cancel(); throw new AiError(413, "Repository response exceeds 2 MB. Select a smaller repository."); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AiError(503, "GitHub returned malformed data."); }
}
export async function files(repository: string, ref: string, config: NonNullable<ReturnType<typeof githubConfig>>, request: typeof fetch = fetch) {
  allowedRepository(repository, config);
  const commit = await githubJson(`/repos/${repository}/commits/${encodeURIComponent(ref)}`, config, request);
  if (!/^[a-f0-9]{40}$/.test(commit?.sha) || !/^[a-f0-9]{40}$/.test(commit?.commit?.tree?.sha)) throw new AiError(503, "GitHub returned invalid commit provenance.");
  const tree = await githubJson(`/repos/${repository}/git/trees/${commit.commit.tree.sha}?recursive=1`, config, request);
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 10_000) throw new AiError(413, "Repository tree is too large or truncated. Use a smaller repository; incomplete listings are never presented as complete.");
  return { commit: commit.sha, files: tree.tree.filter((f: any) => f.type === "blob" && f.mode !== "120000" && f.size <= 256_000 &&
    typeof f.path === "string" && /\.(abap|asprog|asclas|asintf|acds|ddls|xml|json|txt)$/i.test(f.path) && /^[a-f0-9]{40}$/.test(f.sha))
    .map((f: any) => ({ path: f.path, sha: f.sha, size: f.size })) as Array<{ path: string; sha: string; size: number }> };
}
export async function source(repository: string, commit: string, path: string, config: NonNullable<ReturnType<typeof githubConfig>>, request: typeof fetch = fetch) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new AiError(400, "An immutable commit ID is required.");
  const listing = await files(repository, commit, config, request);
  if (listing.commit !== commit) throw new AiError(409, "GitHub commit changed unexpectedly.");
  const selected = listing.files.find(f => f.path === path);
  if (!selected) throw new AiError(404, "Selected file is not an allowed source file at this commit.");
  const blob = await githubJson(`/repos/${repository}/git/blobs/${selected.sha}`, config, request);
  if (blob.encoding !== "base64" || typeof blob.content !== "string" || blob.sha !== selected.sha) throw new AiError(503, "Invalid GitHub blob response.");
  const bytes = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
  if (bytes.length > 256_000 || bytes.length !== selected.size || bytes.includes(0)) throw new AiError(413, "Source must be bounded UTF-8 text, not binary data.");
  const gitHash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (gitHash !== selected.sha) throw new AiError(503, "Source integrity verification failed.");
  let code: string;
  try { code = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AiError(400, "Source is not valid UTF-8 text."); }
  return { code, bytes, sha256: createHash("sha256").update(bytes).digest("hex"), blob: selected.sha };
}
export function analyzeSource(sources: Array<{ path: string; code: string }>) {
  const evidence: Array<{ path: string; line: number; text: string }> = [];
  let directWrite = false;
  for (const source of sources) {
    source.code.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*\*/.test(line)) return; // ABAP comment line
      const code = line.split('"')[0];
      const write = /^\s*(?:UPDATE|MODIFY|INSERT\s+INTO|DELETE\s+FROM)\s+(?:BSEG|BKPF|MARA|MARD|MSEG|VBAK|VBAP|KNA1|LFA1)\b/i.test(code);
      const classic = /\bCALL\s+FUNCTION\b|\bCALL\s+TRANSACTION\b/i.test(code);
      if ((write || classic) && evidence.length < 100) {
        evidence.push({ path: source.path, line: index + 1, text: line.slice(0, 500) });
        directWrite ||= write;
      }
    });
  }
  return {
    classification: directWrite ? "D" : evidence.length ? "C" : null,
    classificationExplanation: directWrite ? "Source contains a potential direct write to a recognized SAP standard table. Confirm syntax and execution context before accepting level D."
      : evidence.length ? "Source contains classic function/transaction calls. Contract release status and use context require reviewer validation."
      : "No supported risk pattern was detected. Absence of a match does not establish Clean Core compliance.",
    recommendation: directWrite ? "Investigate a released write API for the business operation; validate the proposed successor against uploaded S/4HANA 2025 guidance."
      : "Validate called contracts and extension patterns against uploaded S/4HANA 2025 guidance; do not infer release status from names.",
    evidence,
    notice: "Deterministic lexical proposal, not an ABAP compiler or release certification. Code was not executed or sent to AI. Accept explicitly; existing manual decisions remain unchanged.",
  };
}
