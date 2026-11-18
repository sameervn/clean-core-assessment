import { pool } from "@workspace/db";
import { initializeProjects } from "../src/projects/service";
await initializeProjects();
await pool.end();
