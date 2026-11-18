import "./runtime-env";
import * as schema from "./schema";
/** Control-plane access. Product handlers must use pool inside a verified scope. */
export declare const systemPool: import("pg").Pool;
export declare const pool: import("pg").Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
};
export * from "./schema";
export { projectDatabaseScope, withProjectDatabase, type ProjectDatabaseScope } from "./project-scope";
export type { PoolClient } from "pg";
//# sourceMappingURL=index.d.ts.map