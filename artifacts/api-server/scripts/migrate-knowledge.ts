import "@workspace/db/runtime-env";
import { initializeKnowledge } from "../src/knowledge/schema";
import { pool } from "@workspace/db";
try {
  await initializeKnowledge();
  console.log("Knowledge schema initialized.");
} catch {
  console.error("Knowledge migration failed. Check database connectivity and deployment-role schema privileges.");
  process.exitCode = 1;
} finally { await pool.end(); }
