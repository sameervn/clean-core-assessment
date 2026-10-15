import pg, { type PoolConfig } from "pg";
import { readFileSync } from "node:fs";

export function databaseConfig(env: Record<string, string | undefined>, readCA = (path: string) => readFileSync(path, "utf8")): PoolConfig {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  const url = new URL(env.DATABASE_URL);
  const caPath = env.CC_DB_CA_FILE;
  const tlsKeys = [...url.searchParams.keys()].filter(key => /^ssl/i.test(key) || key.toLowerCase() === "uselibpqcompat");
  // Never let pg-connection-string overwrite explicit TLS settings. Preserve
  // existing verified sslmode=require URLs by normalizing that sole safe option.
  if (tlsKeys.some(key => key !== "sslmode") || (caPath && tlsKeys.length)) {
    throw new Error("Database URL TLS overrides are not allowed; use CC_DB_CA_FILE");
  }
  const modes = url.searchParams.getAll("sslmode");
  const allowPlaintext = !caPath && (env.CC_DB_ALLOW_PLAINTEXT === "true"
    || (env.NODE_ENV !== "production" && !env.CC_STATIC_DIR));
  const plainMode = modes.length === 1 && modes[0] === "disable" && allowPlaintext;
  if (modes.length > 1 || (modes.length && !plainMode && !["require", "verify-ca", "verify-full"].includes(modes[0]))) {
    throw new Error("Database URL must not disable TLS verification");
  }
  url.searchParams.delete("sslmode");
  const verified = !!caPath || (modes.length > 0 && !plainMode)
    || ((env.NODE_ENV === "production" || !!env.CC_STATIC_DIR) && env.CC_DB_ALLOW_PLAINTEXT !== "true");
  if (verified && env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification must not be disabled");
  const max = Number(env.CC_DB_POOL_MAX ?? "10");
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("Invalid database pool size");
  const config: PoolConfig = {
    connectionString: url.toString(), max, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000,
    ...(verified ? { ssl: { rejectUnauthorized: true, ...(caPath ? { ca: readCA(caPath) } : {}) } } : plainMode ? { ssl: false } : {}),
  };
  if (verified) {
    // Inspect pg's final parsed settings without making a connection.
    const client = new pg.Client(config);
    const effective = (client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;
    if (!effective || typeof effective !== "object" || (effective as { rejectUnauthorized?: boolean }).rejectUnauthorized !== true) {
      throw new Error("Effective PostgreSQL configuration must verify TLS");
    }
  }
  return config;
}
