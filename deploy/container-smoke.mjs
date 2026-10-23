// Disposable Compose verification; never uses the workspace/client database.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve("generated-artifacts/container-smoke");
mkdirSync(dir, { recursive: true });
const envFile = resolve(dir, ".env");
writeFileSync(envFile, [
  `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
  `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
  `CC_BOOTSTRAP_PASSWORD=${randomBytes(24).toString("hex")}`,
  "CC_AI_ENABLED=false",
].join("\n"), { mode: 0o600 });
const env = { ...process.env, CC_ENV_FILE: envFile };
const args = ["compose", "-p", "cc-portability-smoke", "--env-file", envFile, "-f", "deploy/docker-compose.yml"];
function run(extra, input) {
  const result = spawnSync("docker", [...args, ...extra], { env, input, encoding: "utf8", maxBuffer: 10_000_000 });
  if (result.status !== 0) {
    let output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const value = line.slice(line.indexOf("=") + 1);
      if (value.length > 12) output = output.split(value).join("[redacted]");
    }
    process.stderr.write(output.slice(-12000));
    throw new Error(`Compose command failed: ${extra.slice(0, 2).join(" ")} (exit ${result.status})`);
  }
  return result.stdout;
}
try {
  if (process.env.CC_SMOKE_SKIP_BUILD !== "true") run(["build", "app"]);
  run(["up", "--no-build", "-d"]);
  // The disposable container receives this script on stdin, not the deploy tree.
  const smoke = readFileSync("deploy/smoke-api.mjs", "utf8").replace(
    'import { withPrivateTempFile } from "./private-temp.mjs";',
    readFileSync("deploy/private-temp.mjs", "utf8"),
  );
  process.stdout.write(run(["exec", "-T", "app", "node", "--input-type=module"], smoke));
  // Repeat migration with existing rows and objects: no destructive schema push.
  run(["run", "--rm", "migrate"]);
  run(["restart", "app"]);
  process.stdout.write(run(["exec", "-T", "app", "node", "--input-type=module"], `
    import assert from 'node:assert/strict';
    let ok=false;
    for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:8080/ready')).ok){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
    assert(ok);
    const fs=await import('node:fs/promises');
    const records=await fs.readdir('/data');
    assert(records.some(n=>!n.startsWith('.')));
    const login=await fetch('http://127.0.0.1:8080/api/auth/login',{method:'POST',headers:{Origin:'http://127.0.0.1:8080','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.CC_BOOTSTRAP_PASSWORD+'-changed'})});
    assert.equal(login.status,200);
    process.stdout.write('Upgrade/restart preserved account password and document files\\n');
  `));
  const id = run(["ps", "-q", "app"]).trim();
  const before = Date.now();
  run(["stop", "app"]);
  const result = spawnSync("docker", ["inspect", "--format", "{{.State.ExitCode}}", id], { encoding: "utf8" });
  if (result.stdout.trim() !== "0") throw new Error("Graceful shutdown failed");
  process.stdout.write(`Read-only-root Compose smoke passed; SIGTERM exit 0 after ${Date.now() - before}ms\n`);
} finally {
  run(["down", "-v", "--remove-orphans"]); // Only this disposable named project.
  rmSync(envFile, { force: true });
}
