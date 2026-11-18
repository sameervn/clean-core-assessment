import "./runtime-env";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { databaseConfig } from "./config";
import { projectScopedPool } from "./project-scope";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/** Control-plane access. Product handlers must use pool inside a verified scope. */
export const systemPool = new Pool(databaseConfig(process.env));
export const pool = projectScopedPool(systemPool);
export const db = drizzle(pool, { schema });

export * from "./schema";
export { projectDatabaseScope, withProjectDatabase, type ProjectDatabaseScope } from "./project-scope";
export type { PoolClient } from "pg";
