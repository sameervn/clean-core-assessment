import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("runtime file loads before configuration imports; explicit injection wins; failure is sanitized", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-env-test-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, 'CC_FIXTURE="from file"\nCC_EXISTING=file\nCC_EMPTY=file\n', { mode: 0o600 });
    const loader = resolve("../../lib/db/src/runtime-env.ts");
    const run = (filePath?: string) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import ${JSON.stringify(loader)}; console.log(JSON.stringify([process.env.CC_FIXTURE,process.env.CC_EXISTING,process.env.CC_EMPTY]));`],
    { encoding: "utf8", env: { PATH: process.env.PATH, CC_EXISTING: "injected", CC_EMPTY: "",
      ...(filePath ? { CC_RUNTIME_ENV_FILE: filePath } : {}) } });
    const result = run(file);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["from file", "injected", ""]);
    assert.deepEqual(JSON.parse(run().stdout), [null, "injected", ""]);
    for (const bad of ["relative.env", join(dir, "private-missing.env")]) {
      const result = run(bad);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Runtime environment file could not be loaded/);
      assert.ok(!result.stderr.includes("private-missing"));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
