#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL only. Never uses the workspace/deployment DATABASE_URL.
data=$(mktemp -d /tmp/cc-provisioning.XXXXXX)
port=55439
cleanup() { pg_ctl -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT
initdb -D "$data" -A trust -U postgres >/dev/null
pg_ctl -D "$data" -l "$data/server.log" -o "-h 127.0.0.1 -p $port -k $data" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT=$port PGUSER=postgres PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE cc_test_owner NOLOGIN;
CREATE ROLE cc_test_migrator LOGIN NOINHERIT;
CREATE ROLE cc_test_provisioner LOGIN NOINHERIT;
CREATE ROLE cc_test_app LOGIN NOINHERIT;
GRANT cc_test_owner TO cc_test_migrator,cc_test_provisioner;
CREATE DATABASE cc_provisioning_test OWNER cc_test_migrator;
REVOKE CREATE ON DATABASE cc_provisioning_test FROM PUBLIC;
GRANT CONNECT ON DATABASE cc_provisioning_test TO cc_test_app,cc_test_provisioner;
GRANT CREATE ON DATABASE cc_provisioning_test TO cc_test_owner;
SQL
export PGDATABASE=cc_provisioning_test
psql -X -v ON_ERROR_STOP=1 -c 'REVOKE CREATE ON SCHEMA public FROM PUBLIC' >/dev/null
export DATABASE_URL="postgresql://cc_test_migrator@127.0.0.1:$port/cc_provisioning_test?sslmode=disable"
export NODE_ENV=development CC_DB_ALLOW_PLAINTEXT=true CC_SCHEMA_BOOTSTRAP=false
export CC_PROJECT_OWNER_ROLE=cc_test_owner CC_PROJECT_RUNTIME_ROLE=cc_test_app
pnpm exec tsx scripts/migrate-client.ts
psql -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO cc_test_provisioner;
GRANT SELECT ON public.cc_projects,public.cc_accounts TO cc_test_provisioner;
GRANT UPDATE(provisioning_status,provisioning_error) ON public.cc_projects TO cc_test_provisioner;
GRANT UPDATE(id) ON public.cc_accounts TO cc_test_provisioner;
GRANT INSERT ON public.cc_project_audit TO cc_test_provisioner;
GRANT USAGE,SELECT ON SEQUENCE public.cc_project_audit_id_seq TO cc_test_provisioner;
SQL
export DATABASE_URL="postgresql://cc_test_app@127.0.0.1:$port/cc_provisioning_test?sslmode=disable"
CC_TEST_PROVISIONING=true pnpm exec tsx --test src/project-provisioning.test.ts
