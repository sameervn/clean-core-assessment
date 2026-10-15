import test from "node:test";
import assert from "node:assert/strict";
import { databaseConfig } from "@workspace/db/config";
const base = { DATABASE_URL: "postgresql://app:synthetic@db.example.com/clean_core", NODE_ENV: "production" };
test("PostgreSQL URL cannot override verified TLS, including ssl and libpq compatibility", () => {
  for (const suffix of [
    "ssl=0", "ssl=false", "ssl=true", "uselibpqcompat=true&sslmode=require",
    "sslmode=no-verify", "sslmode=disable", "sslmode=prefer", "sslmode=allow",
    "sslcert=/tmp/client.pem", "sslrootcert=/tmp/ca.pem", "sslkey=/tmp/key",
    "sslmode=require&sslmode=disable", "SSL=0",
  ]) {
    for (const ca of [undefined, "/etc/db-ca/ca.pem"]) {
      assert.throws(() => databaseConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?${suffix}`, CC_DB_CA_FILE: ca }, () => "fixture-ca"), suffix);
    }
  }
});
test("Verified modes are normalized before pg parsing and CA trust remains explicit", () => {
  for (const mode of ["require", "verify-ca", "verify-full"]) {
    const config = databaseConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=${mode}` });
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
    assert(!config.connectionString?.includes("sslmode"));
  }
  assert.deepEqual(databaseConfig({ ...base, CC_DB_CA_FILE: "/etc/db-ca/ca.pem" }, () => "fixture-ca").ssl, {
    rejectUnauthorized: true, ca: "fixture-ca",
  });
  assert.throws(() => databaseConfig({ ...base, NODE_TLS_REJECT_UNAUTHORIZED: "0" }));
  assert.equal(databaseConfig({ ...base, CC_DB_ALLOW_PLAINTEXT: "true" }).ssl, undefined);
  assert.deepEqual(databaseConfig(base).ssl, { rejectUnauthorized: true });
});
test("Replit development plaintext URL stays supported without weakening portable production", () => {
  const url = `${base.DATABASE_URL}?sslmode=disable`;
  assert.equal(databaseConfig({ DATABASE_URL: url, NODE_ENV: "development" }).ssl, false);
  assert.throws(() => databaseConfig({ DATABASE_URL: url, NODE_ENV: "development", CC_STATIC_DIR: "/app/public" }));
  assert.equal(databaseConfig({ ...base, DATABASE_URL: url, CC_DB_ALLOW_PLAINTEXT: "true" }).ssl, false);
});
