import "@workspace/db/runtime-env";
import { initializeProjects } from "../src/projects/service";
import { pool } from "@workspace/db";
try {
  await initializeProjects();
  console.log("Knowledge schema initialized.");
} catch {
  console.error("Knowledge migration failed. Check database connectivity and deployment-role schema privileges.");
  process.exitCode = 1;
} finally { await pool.end(); }
