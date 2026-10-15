import { loadEnvFile } from "node:process";
import { isAbsolute } from "node:path";

// Explicit opt-in only. Node preserves already injected environment values.
// This side effect must run before any configuration-dependent import.
if (process.env.CC_RUNTIME_ENV_FILE) {
  try {
    if (!isAbsolute(process.env.CC_RUNTIME_ENV_FILE)) throw new Error();
    loadEnvFile(process.env.CC_RUNTIME_ENV_FILE);
  } catch {
    throw new Error("Runtime environment file could not be loaded. Check its absolute path, format and permissions.");
  }
}
