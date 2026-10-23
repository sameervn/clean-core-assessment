import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function withPrivateTempFile(action) {
  const directory = await mkdtemp(join(tmpdir(), "cc-smoke-"));
  try {
    const filename = join(directory, "write-check");
    const handle = await open(filename, "wx", 0o600);
    try { return await action(handle, filename, directory); }
    finally { await handle.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
