import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

export interface ProjectDatabaseScope { projectId: string; schema: string; legacy: boolean; actorId?: string }
const context = new AsyncLocalStorage<ProjectDatabaseScope>();
export function projectDatabaseScope() { return context.getStore(); }
export function withProjectDatabase<T>(scope: ProjectDatabaseScope, fn: () => T): T {
  if (!/^ccp_[a-f0-9]{32}$/.test(scope.schema)) throw new Error("Invalid project database namespace");
  return context.run(Object.freeze({ ...scope }), fn);
}

/**
 * A project connection has exactly one search-path schema (no public fallback).
 * Its identity views are provisioned explicitly; missing domain tables fail closed.
 * Connections are reset BEFORE being returned to the shared pool.
 */
export function projectScopedPool(raw: pg.Pool): pg.Pool {
  async function connect(): Promise<pg.PoolClient> {
    const scope = context.getStore();
    if (!scope) return raw.connect();
    const client = await raw.connect();
    try { await client.query("SELECT set_config('search_path',$1,false)", [scope.schema]); }
    catch (error) { client.release(error as Error); throw error; }
    let released = false;
    return new Proxy(client, {
      get(target, property) {
        if (property === "release") return (error?: Error | boolean) => {
          if (released) throw new Error("Project connection already released");
          released = true;
          if (error) { target.release(error); return; }
          // Never make a connection with a previous project's search path available.
          void target.query("RESET search_path").then(() => target.release(), failure => target.release(failure));
        };
        if (property === "query") return (...args: any[]) => {
          if (released) return Promise.reject(new Error("Project connection already released"));
          return (target.query as any)(...args);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  return new Proxy(raw, {
    get(target, property) {
      if (property === "connect") return (...args: any[]) => {
        if (!context.getStore()) return (target.connect as any)(...args);
        const callback = args[0];
        if (typeof callback === "function") { void connect().then(c => callback(null, c, c.release), callback); return; }
        return connect();
      };
      if (property === "query") return (...args: any[]) => {
        if (!context.getStore()) return (target.query as any)(...args);
        const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
        const promise = (async () => {
          const client = await connect();
          try { return await (client.query as any)(...args); }
          finally { client.release(); }
        })();
        if (callback) { void promise.then(result => callback(null, result), callback); return; }
        return promise;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
