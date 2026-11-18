import "@workspace/db/runtime-env";
import { provisionNextProject, closeProvisioner } from "../src/projects/provisioner";
import { provisioningRoles } from "../src/projects/service";
import { logger } from "../src/lib/logger";

try {
  if (!provisioningRoles().owner) throw new Error("Explicit owner and runtime roles required");
  // Bounded operator job. A killed job rolls back; the request stays pending.
  for (let i = 0; i < 20; i++) {
    const status = await provisionNextProject();
    if (status === "idle") break;
    logger.info({ status }, "Project provisioning attempt finished");
    if (status === "failed") process.exitCode = 1;
  }
} catch {
  logger.error("Project provisioner unavailable; check operator database access and role configuration");
  process.exitCode = 1;
} finally { await closeProvisioner(); }
