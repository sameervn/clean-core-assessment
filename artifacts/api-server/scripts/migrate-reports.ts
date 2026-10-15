import { pool } from "@workspace/db";
import { initializeReports } from "../src/reports/schema";
await initializeReports();
await pool.end();
