import type pg from "pg";
export interface ProjectDatabaseScope {
    projectId: string;
    schema: string;
    legacy: boolean;
    actorId?: string;
}
export declare function projectDatabaseScope(): ProjectDatabaseScope | undefined;
export declare function withProjectDatabase<T>(scope: ProjectDatabaseScope, fn: () => T): T;
/**
 * A project connection has exactly one search-path schema (no public fallback).
 * Its identity views are provisioned explicitly; missing domain tables fail closed.
 * Connections are reset BEFORE being returned to the shared pool.
 */
export declare function projectScopedPool(raw: pg.Pool): pg.Pool;
//# sourceMappingURL=project-scope.d.ts.map