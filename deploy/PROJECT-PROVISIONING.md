# DML-only API and operator project provisioning

The API's `DATABASE_URL` is always the restricted runtime identity. Admin creation
returns HTTP 201 for a **request**, with `provisioningStatus: pending`, not an open
workspace. Only Admins see non-ready projects in the catalog. Ready status,
all schema objects and runtime grants commit together. Project membership alone
never grants access to pending, failed or cancelled projects.

## Roles and first installation

Adapt names/database under DBA control. Create login credentials with client
secret tooling, not checked-in SQL, Helm values or browser configuration.
Neither operator login is a superuser. The provisioner is privileged within this
database and must be isolated from the API; it is not a safe general SQL service.

```sql
CREATE ROLE clean_core_project_owner NOLOGIN;
CREATE ROLE clean_core_migrator LOGIN NOINHERIT;
CREATE ROLE clean_core_provisioner LOGIN NOINHERIT;
CREATE ROLE clean_core_app LOGIN NOINHERIT;
GRANT clean_core_project_owner TO clean_core_migrator, clean_core_provisioner;
-- Database is pre-created by the DBA, with migration ownership:
ALTER DATABASE clean_core OWNER TO clean_core_migrator;
REVOKE CREATE ON DATABASE clean_core FROM PUBLIC;
GRANT CONNECT ON DATABASE clean_core TO clean_core_app, clean_core_provisioner;
GRANT CREATE ON DATABASE clean_core TO clean_core_project_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

Run `node dist/migrate.mjs` with the migrator's `DATABASE_URL`,
`CC_PROJECT_OWNER_ROLE=clean_core_project_owner` and
`CC_PROJECT_RUNTIME_ROLE=clean_core_app`. It creates/upgrades the public catalog
as migrator and project objects under `SET LOCAL ROLE` to the shared owner.
It explicitly grants public runtime DML, project schema USAGE, table DML and
sequence USAGE/SELECT. It gives the owner SELECT on the public identity/session/
membership tables and REFERENCES on identities for project FKs and filtered
views. The owner also receives UPDATE on account ID and session token-hash
columns: PostgreSQL requires an underlying UPDATE privilege for the existing
`SELECT ... FOR SHARE` authority checks through those views. This does not give
the API DDL rights. Grants are re-applied on each upgrade/provision, so future objects are
covered without relying on creator-dependent default privileges. The API cannot
create tables in public or project schemas and must not own any of them.

After migration, grant the provisioner only its control-plane needs:

```sql
GRANT USAGE ON SCHEMA public TO clean_core_provisioner;
GRANT SELECT ON public.cc_projects, public.cc_accounts TO clean_core_provisioner;
GRANT UPDATE(provisioning_status,provisioning_error) ON public.cc_projects TO clean_core_provisioner;
-- Required by PostgreSQL for SELECT ... FOR SHARE on the requesting account.
GRANT UPDATE(id) ON public.cc_accounts TO clean_core_provisioner;
GRANT INSERT ON public.cc_project_audit TO clean_core_provisioner;
GRANT USAGE,SELECT ON SEQUENCE public.cc_project_audit_id_seq TO clean_core_provisioner;
```

Never grant owner/migrator/provisioner membership, database CREATE, public CREATE,
project CREATE or ownership to the runtime login. Revoke any inherited rights
from old deployments; `NOINHERIT` alone does not prevent `SET ROLE` membership.
Restrict connections at the network boundary and require verified TLS using
`CC_DB_CA_FILE` as in the main deployment guide.

## Existing installations

Back up public **and every project schema**. Stop API writes, pause/suspend
provisioning, and wait for running jobs to finish before changing ownership.
For old deployments where the runtime owned schemas/tables, have a DBA transfer
only application project schemas, their tables/views/sequences and public
control-plane tables/sequences to the designated owner/migrator respectively.
Use an inventory from `public.cc_projects` joined to PostgreSQL catalogs; inspect
every identifier before applying DDL. Do not use a database-wide `REASSIGN OWNED`
when that login owns unrelated objects. Sequences owned by table columns follow
table ownership; inspect standalone sequences and views separately.

The migrator must own public application tables (and the database/public schema,
or have the necessary CREATE privileges there). All existing project objects
must belong to `clean_core_project_owner` before rerunning migrations; DML grants
do not permit ALTER TABLE. Legacy product tables still in public are moved
transactionally by the migrator and assigned to the project owner.
Then revoke runtime CREATE and privileged memberships, run migration, verify role
checks below, and resume the API with `CC_SCHEMA_BOOTSTRAP=false`.
Existing catalog rows migrate as ready; new API requests explicitly use pending.

## Running jobs and Helm

Run `node dist/provision.mjs` with **only** the provisioner's database identity and
the same owner/runtime role names. This is a bounded one-shot process (20 attempts
maximum), suitable for an operator job or scheduled CronJob. It has no HTTP
listener, browser credential, arbitrary SQL input or object-storage access.
Role identifiers come only from trusted operator configuration and are validated.
Project schema names are recomputed from internal UUIDs and checked against the
catalog; existing schemas are never adopted or dropped.

Helm: enable `migration.enabled` and `provisioning.enabled` with pre-existing,
separate Secrets and set `provisioning.serviceAccountName` to a pre-created
operator service account. Set `migration.projectOwnerRole/projectRuntimeRole` and
`provisioning.projectOwnerRole/projectRuntimeRole` consistently. The CronJob
defaults to every minute, Forbid concurrency, 180-second deadline and at most
one Kubernetes retry; jobs retain limited history. Its Secret contains
`DATABASE_URL` for the provisioner only and is never mounted on the Deployment.
The migration Secret is separate again. Prefer external Secret management.
The provisioner honors the existing database CA ConfigMap and hardened security/
resource settings. Network policies must allow provisioner PostgreSQL egress
(its pods carry the application's `app` label).

Suspend the CronJob and wait for active jobs before upgrades; upgrade migration
and provisioner images together. The database lock also serializes migration
against active provisioning transactions. Older API pods must be drained during
the initial transition because they do not understand non-ready states.

## Failures, retry and cleanup

- Admin requests, retries and cancellations require an active Admin session,
  same-origin request and CSRF token. They are recorded in the project audit.
  Processing rechecks the requesting Admin's active/password state and role.
- Pending remains pending while a row-locked transaction runs. Concurrent
  provisioners skip locked rows. A crash or deadline rolls back the transaction,
  releases the lock and leaves pending work for the next job.
- Setup errors roll back schema DDL, grants, role and search-path changes to a
  savepoint, then commit failed status and a minimal audit event. The job exits
  nonzero if any attempt failed. Logs contain project ID and SQLSTATE only, not
  raw SQL messages or credentials. Investigate ownership, missing roles, public
  view/FK grants and requesting Admin authority.
- After correction, **Retry setup** queues the same failed request again. No
  automatic repeated attempt is made for a failed request.
- **Cancel setup** on a pending/failed request retains catalog and audit history
  but permanently removes it from processing. This is cleanup of unfinished
  setup, not deletion of a ready project. All schema objects created by a failed
  transaction have already been rolled back. If an unexpected pre-existing
  schema caused failure, cancellation deliberately leaves it untouched: the DBA
  must inspect its ownership/data and remove it only under approved retention
  procedures. Never drop a schema just because a request failed.
- Ready/cancelled requests cannot be retried or cancelled again; concurrent
  changes return 409 and the Admin list refreshes.

## Verification

From `artifacts/api-server`, run:

```sh
bash scripts/verify-project-provisioning.sh
```

Requires local PostgreSQL tools and a free loopback port 55439. This creates and
destroys a disposable database cluster, never using deployment credentials.
It verifies distinct migrator/provisioner/runtime logins, runtime DDL/SET ROLE
denial, Admin/non-Admin API authorization, pending access denial, setup/grant
failure rollback, retry, parallel jobs, cancellation, revoked request authority,
schema collision safety, single ready audit, DML grants and additive upgrades by
the migrator on provisioner-created objects. Repeat these role checks with client
DBA tooling in staging; this local test does not attest cloud IAM/network policy.
