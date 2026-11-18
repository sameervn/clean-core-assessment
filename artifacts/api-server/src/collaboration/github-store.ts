import { randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { AiError } from "../assessment-ai";
import type { Identity } from "../auth/middleware";
import { current, transaction } from "./service";
import { githubEncryptionReady, openGithubToken, sealGithubToken, verifyGithubConnection } from "./github-credentials";
import type { z } from "zod";
import type { githubConnectionInput } from "./github-credentials";
import type { GithubConfig } from "./github";

type Connection = { repository: string; username: string; encrypted_token: string; credential_version: string; connected_at: Date };
export async function githubConnectionStatus(identity: Identity, database: Pick<PoolClient, "query"> = pool) {
  await current(database, identity);
  const configured = githubEncryptionReady();
  const rows = (await database.query<Connection>(
    "SELECT repository,username,encrypted_token,credential_version,connected_at FROM cc_github_credentials WHERE user_id=$1 ORDER BY repository",
    [identity.user.id],
  )).rows;
  const connections = rows.map(row => {
    let usable = false;
    try { if (configured) { openGithubToken(row.encrypted_token, String(identity.user.id), row.repository, row.username); usable = true; } } catch { /* Show reconnect rather than claiming a usable connection. */ }
    return { repository: row.repository, username: row.username, connectedAt: row.connected_at.toISOString(), usable };
  });
  return { configured, connected: connections.some(c => c.usable), repositories: connections.filter(c => c.usable).map(c => c.repository), connections };
}
export async function githubEditor(identity: Identity, database: Pick<PoolClient, "query"> = pool) {
  const user = await current(database, identity);
  if (!["Admin", "Developer"].includes(user.role) || !user.permissions.includes("evidence")) {
    throw new AiError(403, "Admin or Developer with Load evidence permission is required.");
  }
  return user;
}
export async function savedGithubConfig(identity: Identity, repository: string, database: Pick<PoolClient, "query"> = pool): Promise<GithubConfig & { credentialVersion: string }> {
  await githubEditor(identity, database);
  const row = (await database.query<Connection>(
    "SELECT repository,username,encrypted_token,credential_version,connected_at FROM cc_github_credentials WHERE user_id=$1 AND repository=$2 FOR SHARE",
    [identity.user.id, repository],
  )).rows[0];
  if (!row) throw new AiError(409, "Connect this repository in GitHub Connections first.");
  return {
    token: openGithubToken(row.encrypted_token, String(identity.user.id), row.repository, row.username),
    repositories: [row.repository], credentialVersion: row.credential_version,
  };
}
export async function saveGithubConnection(identity: Identity, input: z.infer<typeof githubConnectionInput>, request: typeof fetch = fetch) {
  await githubEditor(identity);
  // Check encryption before contacting GitHub; never persist plaintext even on failure.
  const encrypted = sealGithubToken(input.token, String(identity.user.id), input.repository, input.username);
  await verifyGithubConnection(input, request);
  await transaction(async c => {
    // Acquire the exclusive account lock before current() takes a shared lock.
    await c.query("SELECT id FROM cc_accounts WHERE id=$1 FOR UPDATE", [identity.user.id]);
    const user = await current(c, identity);
    if (!["Admin", "Developer"].includes(user.role) || !user.permissions.includes("evidence")) {
      throw new AiError(403, "Source access permission changed. No connection was saved.");
    }
    // Serialize per-account additions so concurrent requests cannot exceed the cap.
    const existing = await c.query("SELECT repository FROM cc_github_credentials WHERE user_id=$1", [user.id]);
    if (existing.rowCount! >= 100 && !existing.rows.some(r => r.repository === input.repository)) throw new AiError(400, "At most 100 repository connections per account.");
    await c.query(`INSERT INTO cc_github_credentials(user_id,repository,username,encrypted_token,credential_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,repository) DO UPDATE SET
      username=EXCLUDED.username,encrypted_token=EXCLUDED.encrypted_token,credential_version=EXCLUDED.credential_version,connected_at=now()`,
    [user.id, input.repository, input.username, encrypted, randomUUID()]);
  });
}
