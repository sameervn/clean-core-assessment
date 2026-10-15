import "./runtime-env";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { databaseConfig } from "./config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool(databaseConfig(process.env));
export const db = drizzle(pool, { schema });

export * from "./schema";
export type { PoolClient } from "pg";
