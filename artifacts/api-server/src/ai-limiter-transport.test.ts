import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedAiLimiter } from "./ai-limiter";
import { AiError } from "./assessment-ai";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
const unavailable = (error: unknown) => error instanceof AiError && error.status === 503;

test("real HTTP redirects never forward authorization or retry acquisitions", async () => {
  let destinationCalls = 0, sourceCalls = 0;
  const destination = createServer((_req, res) => {
    destinationCalls++; res.end('{"result":1}');
  });
  const target = await listen(destination);
  let code = 301;
  const source = createServer((req, res) => {
    sourceCalls++;
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    res.writeHead(code, { Location: `http://${target}/` }); res.end();
  });
  const origin = await listen(source);
  try {
    const limiter = sharedAiLimiter({ url: `http://${origin}`, token: "synthetic-token", namespace: "ci-redirect" });
    for (code of [301, 302, 303, 307, 308]) await assert.rejects(limiter.acquire("synthetic"), unavailable);
    assert.equal(sourceCalls, 5);
    assert.equal(destinationCalls, 0);
  } finally { await close(source); await close(destination); }
});

test("REST errors and uncertain outcomes fail closed without retries, then recover", async () => {
  let calls = 0;
  let mode: "ok" | "unavailable" | "disconnect" | "timeout" | "malformed" = "ok";
  const server = createServer((req, res) => {
    calls++;
    if (mode === "disconnect") { req.socket.destroy(); return; }
    if (mode === "timeout") return;
    if (mode === "unavailable") { res.writeHead(503); res.end("private-service-error"); return; }
    res.end(mode === "malformed" ? '{"result":"1"}' : '{"result":1}');
  });
  const address = await listen(server);
  const limiter = sharedAiLimiter({ url: `http://${address}`, token: "synthetic-token", namespace: "ci-outage" });
  try {
    const release = await limiter.acquire("synthetic-held");
    mode = "unavailable";
    await assert.rejects(release(), unavailable);
    for (mode of ["unavailable", "disconnect", "timeout", "malformed"] as const) {
      const before = calls;
      await assert.rejects(limiter.acquire("synthetic"), unavailable);
      assert.equal(calls, before + 1, "uncertain writes must not be retried");
    }
    mode = "ok";
    await release();
    await (await limiter.acquire("synthetic-recovered"))();
  } finally { await close(server); }
});

test("untrusted TLS certificate is rejected before a command reaches the server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-ai-tls-"));
  let server: Server | undefined;
  try {
    // Mandatory in CI: missing openssl is a failure, never a skipped TLS test.
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"]);
    let calls = 0;
    server = createSecureServer({
      key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")),
    }, (_req, res) => { calls++; res.end('{"result":1}'); });
    const address = await listen(server);
    await assert.rejects(sharedAiLimiter({
      url: `https://${address}`, token: "synthetic-token", namespace: "ci-tls",
    }).acquire("synthetic"), unavailable);
    assert.equal(calls, 0);
  } finally { if (server) await close(server); await rm(dir, { recursive: true, force: true }); }
});
