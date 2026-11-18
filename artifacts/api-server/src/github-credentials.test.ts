import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { publicUser } from "./auth/service";
import { githubConnectionInput, githubEncryptionReady, normalizeRepository, openGithubToken, sealGithubToken, verifyGithubConnection } from "./collaboration/github-credentials";
import { githubConnectionStatus, savedGithubConfig, saveGithubConnection } from "./collaboration/github-store";
import type { Identity } from "./auth/middleware";

const env = { SESSION_SECRET: "synthetic-github-encryption-test-secret-0000" };
const token = "github_pat_" + "synthetic".repeat(8);
const input = { repository: "owner/repo", username: "octocat", token };
const row = (id: string, role = "Developer", overrides = {}) => ({
  id, username: `fixture-${id}`, password_hash: "", role, active: true, must_change_password: false, overrides,
});
const identity = (id: string, role = "Developer", overrides = {}): Identity => ({ user: publicUser(row(id, role, overrides)), tokenHash: `session-${id}`, csrf: "synthetic" });
const verifiedFetch: typeof fetch = async (url, options) => {
  assert.equal(options?.method, undefined); // GitHub operations are GET only.
  assert.equal(options?.redirect, "error");
  assert.equal(new URL(String(url)).origin, "https://api.github.com");
  if (String(url).endsWith("/user")) return Response.json({ login: "Octocat" });
  if (String(url).endsWith("/contents/")) return Response.json([{ name: "z.abap" }]);
  return Response.json({ full_name: "Owner/Repo" });
};

test("repository and credential validation reject passwords, broad tokens and arbitrary hosts", () => {
  assert.equal(normalizeRepository("https://github.com/Owner/Repo.git/"), "owner/repo");
  assert.equal(normalizeRepository("Owner/Repo"), "owner/repo");
  for (const repository of ["http://github.com/owner/repo", "https://evil.test/owner/repo", "https://github.com@evil.test/owner/repo", "https://user:pass@github.com/owner/repo", "owner/repo/tree/main", "../repo", "owner/..", "https://github.com/owner/repo?token=bad", "git@github.com:owner/repo"]) {
    assert.throws(() => normalizeRepository(repository));
  }
  assert.deepEqual(githubConnectionInput.parse(input), input);
  for (const bad of [null, [], { ...input, username: {} }, { ...input, token: "account-password" }, { ...input, token: "ghp_" + "a".repeat(36) }, { ...input, token: { x: 1 } }, { ...input, userId: "victim" }]) assert.throws(() => githubConnectionInput.parse(bad));
});
test("authenticated encryption binds account, repository and username; rotation/tampering fail closed", () => {
  assert(githubEncryptionReady(env));
  assert(!githubEncryptionReady({}));
  const sealed = sealGithubToken(token, "a", input.repository, input.username, env);
  assert(!sealed.includes(token));
  assert.notEqual(sealed, sealGithubToken(token, "a", input.repository, input.username, env));
  assert.equal(openGithubToken(sealed, "a", input.repository, input.username, env), token);
  for (const [id, repo, user, key] of [
    ["b", input.repository, input.username, env],
    ["a", "other/repo", input.username, env],
    ["a", input.repository, "other-user", env],
    ["a", input.repository, input.username, { SESSION_SECRET: "different-synthetic-encryption-secret-0000" }],
  ] as const) assert.throws(() => openGithubToken(sealed, id, repo, user, key), /Reconnect/);
  assert.throws(() => openGithubToken("v1.bad.bad.bad", "a", input.repository, input.username, env), /Reconnect/);
  assert.throws(() => sealGithubToken(token, "a", input.repository, input.username, {}), /unavailable/);
});
test("verification checks token owner, exact repository and actual Contents permission without writes", async () => {
  await verifyGithubConnection(input, verifiedFetch);
  await assert.rejects(verifyGithubConnection({ ...input, username: "wrong" }, verifiedFetch), /does not belong/);
  await assert.rejects(verifyGithubConnection(input, async url => Response.json(String(url).endsWith("/user") ? { login: input.username } : { full_name: "other/repo" })), /exact repository/);
  await assert.rejects(verifyGithubConnection(input, async (url, options) => String(url).endsWith("/contents/") ? new Response(null, { status: 403 }) : verifiedFetch(url, options)), /denied or revoked/);
  await assert.rejects(verifyGithubConnection(input, async () => new Response(null, { status: 401 })), /denied or revoked/);
});
test("saved credentials remain account-private, encrypted, replaceable and unchanged after failed verification", async t => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = env.SESSION_SECRET;
  t.after(() => { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; });
  const records = new Map<string, any>();
  let currentRole = "Developer";
  let evidence = true;
  const query = async (sql: string, values: any[] = []) => {
    if (sql.includes("JOIN cc_account_sessions")) return { rows: [row(values[0], currentRole, evidence ? {} : { evidence: false })], rowCount: 1 };
    if (sql.startsWith("INSERT INTO cc_github_credentials")) {
      records.set(`${values[0]}:${values[1]}`, { user_id: values[0], repository: values[1], username: values[2], encrypted_token: values[3], credential_version: values[4], connected_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM cc_github_credentials")) {
      const rows = [...records.values()].filter(r => r.user_id === values[0] && (values.length < 2 || r.repository === values[1]));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };
  t.mock.method(pool, "query", query as any);
  t.mock.method(pool, "connect", (async () => ({ query, release() {} })) as any);
  const a = identity("a"), b = identity("b");
  await saveGithubConnection(a, input, verifiedFetch);
  const original = records.get("a:owner/repo");
  assert(original && original.encrypted_token !== token && !original.encrypted_token.includes(token));
  assert.equal((await savedGithubConfig(a, input.repository)).token, token);
  await assert.rejects(savedGithubConfig(b, input.repository), /Connect this repository/);
  const status = await githubConnectionStatus(a);
  assert.equal(status.connections.length, 1);
  assert.deepEqual((await githubConnectionStatus(b)).connections, []);
  assert(!JSON.stringify(status).includes(token));
  assert(!JSON.stringify(status).includes(original.encrypted_token));
  await assert.rejects(saveGithubConnection(a, { ...input, token: token + "2" }, async () => new Response(null, { status: 401 })));
  assert.equal(records.get("a:owner/repo").encrypted_token, original.encrypted_token);
  await saveGithubConnection(a, { ...input, token: token + "2" }, verifiedFetch);
  assert.notEqual(records.get("a:owner/repo").credential_version, original.credential_version);
  currentRole = "Reviewer";
  await assert.rejects(saveGithubConnection(a, input, verifiedFetch), /permission/);
  currentRole = "Developer"; evidence = false;
  await assert.rejects(saveGithubConnection(a, input, verifiedFetch), /permission/);
  currentRole = "Developer"; evidence = true;
  process.env.SESSION_SECRET = "rotated-synthetic-github-key-000000000";
  const rotated = await githubConnectionStatus(a);
  assert.equal(rotated.connected, false);
  assert.equal(rotated.connections[0].usable, false);
  await assert.rejects(savedGithubConfig(a, input.repository), /Reconnect/);
});
