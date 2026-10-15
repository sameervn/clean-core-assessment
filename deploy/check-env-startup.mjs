// Run after the API build. Synthetic settings only; never contacts a database.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "cc-startup-"));
const image = process.argv[2]; // Optional prebuilt Docker image; no build/push.
try {
  const file = join(dir, ".env");
  // A deliberate TLS configuration error proves the file reached DB initialization.
  writeFileSync(file, "DATABASE_URL=postgresql://fixture:fixture@localhost/fixture?sslmode=disable\nNODE_ENV=production\nCC_DB_ALLOW_PLAINTEXT=false\nCC_STATIC_DIR=/app/public\n", { mode: 0o600 });
  for (const entry of ["index", "migrate"]) {
    const run = (path) => spawnSync(image ? "docker" : process.execPath, image
      ? ["run", "--rm", "--network", "none", "--read-only", "-v", `${dir}:/etc/clean-core:ro`,
        "-e", `CC_RUNTIME_ENV_FILE=/etc/clean-core/${path === file ? ".env" : "missing"}`,
        image, "node", `dist/${entry}.mjs`]
      : [`artifacts/api-server/dist/${entry}.mjs`], {
      encoding: "utf8", timeout: 10_000,
      env: { PATH: process.env.PATH, CC_RUNTIME_ENV_FILE: path },
    });
    const loaded = run(file);
    assert.notEqual(loaded.status, 0);
    assert.match(loaded.stderr, /Database URL must not disable TLS verification/);
    assert.doesNotMatch(loaded.stderr, /DATABASE_URL must be set/);
    const missing = run(join(dir, "missing"));
    assert.match(missing.stderr, /Runtime environment file could not be loaded/);
    assert.doesNotMatch(missing.stderr, /DATABASE_URL must be set/);
    console.log(`${entry}: env-file loads before database initialization, missing file fails closed`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
