import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { AiError } from "../assessment-ai";
import { checkGithubRepository, githubJson, type GithubConfig } from "./github";
import { projectDatabaseScope } from "@workspace/db";

const repoPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/;
export function normalizeRepository(value: string) {
  let repository = value.trim();
  if (repository.startsWith("https://")) {
    let url: URL;
    try { url = new URL(repository); } catch { throw new AiError(400, "Enter owner/repository or an HTTPS github.com repository URL."); }
    if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash) {
      throw new AiError(400, "Only HTTPS github.com repository URLs without credentials or query parameters are supported.");
    }
    repository = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  repository = repository.replace(/\.git$/, "");
  if (!repoPattern.test(repository) || repository.split("/").some(part => part === "." || part === "..")) {
    throw new AiError(400, "Enter a repository as owner/repository, not a branch, file, SSH address or another host.");
  }
  return repository.toLowerCase();
}
export const githubConnectionInput = z.object({
  repository: z.string().trim().min(3).max(200).transform(normalizeRepository),
  username: z.string().trim().min(1).max(39).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
  // Reject account passwords and classic broad-scope tokens at the boundary.
  token: z.string().trim().min(20).max(255).regex(/^github_pat_[A-Za-z0-9_]{20,244}$/),
}).strict();

export function githubEncryptionReady(env: Record<string, string | undefined> = process.env) {
  return typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;
}
function key(env: Record<string, string | undefined>) {
  if (!githubEncryptionReady(env)) throw new AiError(503, "Secure GitHub credential storage is unavailable. Ask the administrator to configure the application's session secret.");
  // Domain-separated from session signing, CSRF and evidence-attestation keys.
  return Buffer.from(hkdfSync("sha256", env.SESSION_SECRET!, "clean-core", "github-credentials:aes-256-gcm:v1", 32));
}
const context = (userId: string, repository: string, username: string) => {
  const scope = projectDatabaseScope();
  return Buffer.from(JSON.stringify(scope && !scope.legacy
    ? [scope.projectId, userId, repository, username] : [userId, repository, username]));
};
export function sealGithubToken(token: string, userId: string, repository: string, username: string, env: Record<string, string | undefined> = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  cipher.setAAD(context(userId, repository, username));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function openGithubToken(value: string, userId: string, repository: string, username: string, env: Record<string, string | undefined> = process.env) {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra || value.length > 1000) throw new Error("Invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key(env), Buffer.from(iv, "base64url"));
    decipher.setAAD(context(userId, repository, username));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Do not expose ciphertext, keys, provider responses or token fragments.
    throw new AiError(409, "Saved GitHub credentials cannot be read. Reconnect this repository with a new token.");
  }
}
export async function verifyGithubConnection(input: z.infer<typeof githubConnectionInput>, request: typeof fetch = fetch) {
  const config: GithubConfig = { token: input.token, repositories: [input.repository] };
  const account = await githubJson("/user", config, request);
  if (typeof account?.login !== "string" || account.login.toLowerCase() !== input.username.toLowerCase()) {
    throw new AiError(403, "The token does not belong to the supplied GitHub username.");
  }
  await checkGithubRepository(input.repository, config, request);
}
