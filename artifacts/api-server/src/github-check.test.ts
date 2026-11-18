import test from "node:test";
import assert from "node:assert/strict";
import { CheckSharedGithubBody } from "@workspace/api-zod";
import { checkGithubRepository } from "./collaboration/github";

const repository = "owner/repo";
const config = { token: "synthetic-test-token", repositories: [repository] };

test("connection check reads only repository metadata and contents using the saved credential", async () => {
  const paths: string[] = [];
  await checkGithubRepository(repository, config, async (url, options) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://api.github.com");
    assert.equal(options?.method, undefined); // fetch defaults to GET
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${config.token}`);
    assert.equal(options?.body, undefined);
    paths.push(parsed.pathname);
    return Response.json(parsed.pathname.endsWith("/contents/") ? [] : { full_name: "Owner/Repo" });
  });
  assert.deepEqual(paths, ["/repos/owner/repo", "/repos/owner/repo/contents/"]);
});

test("connection check rejects repositories outside the account allowlist before network access", async () => {
  let calls = 0;
  await assert.rejects(checkGithubRepository("someone/else", config, async () => {
    calls++;
    return Response.json({});
  }), /allowlist/);
  assert.equal(calls, 0);
});

test("connection check requires exact metadata and real contents access", async () => {
  await assert.rejects(checkGithubRepository(repository, config, async () => Response.json({ full_name: "other/repo" })), /exact repository/);
  await assert.rejects(checkGithubRepository(repository, config, async url =>
    String(url).endsWith("/contents/") ? new Response(null, { status: 403 }) : Response.json({ full_name: repository }),
  ), /denied or revoked/);
});

test("connection failures expose safe errors rather than provider payloads or credentials", async () => {
  for (const [status, expectedStatus] of [[401, 403], [404, 404], [429, 429], [500, 503]]) {
    await assert.rejects(checkGithubRepository(repository, config, async () =>
      new Response(`sensitive-provider-payload ${config.token}`, { status }),
    ), (error: any) => {
      assert.equal(error.status, expectedStatus);
      assert.ok(!error.message.includes(config.token));
      assert.ok(!error.message.includes("sensitive-provider-payload"));
      return true;
    });
  }
  await assert.rejects(checkGithubRepository(repository, config, async () => {
    throw new Error(config.token);
  }), /could not be reached/);
});

test("check request accepts only a bounded repository, never a supplied token", () => {
  assert.deepEqual(CheckSharedGithubBody.strict().parse({ repository }), { repository });
  for (const body of [{}, { repository: 3 }, { repository: "x".repeat(201) }, { repository, token: config.token }]) {
    assert.equal(CheckSharedGithubBody.strict().safeParse(body).success, false);
  }
});
