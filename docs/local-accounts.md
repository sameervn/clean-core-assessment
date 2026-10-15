# Local accounts and roles

This app uses its own username/password accounts. No Clerk, Replit sign-in or
external identity provider is required. There is no public sign-up.

## First deployment

1. Supply a PostgreSQL connection as `DATABASE_URL` via the hosting secret manager.
   Use verified TLS for client RDS connections according to the client's database
   policy. The application requires tables defined by the account Drizzle schema.
   For Replit development run `pnpm --filter @workspace/db run push`; Replit
   publishing applies managed production schema changes. For a client-managed RDS
   deployment, have the database administrator review and apply the schema using
   the client's migration process before starting the app. Account startup does not
   run DDL; the new knowledge-library initializer runs additive DDL at startup
   (see `docs/knowledge-base.md` for its storage and schema requirements).
2. Keep `SESSION_SECRET` configured for evidence signing and account throttle-key
   hashing. Use a separate random secret for each deployment and identical values
   across replicas of the same deployment.
3. Set `CC_BOOTSTRAP_PASSWORD` through the secret manager to a unique, strong
   temporary password of 14–128 characters. Do not put real passwords in source,
   deployment templates, chat, tickets or logs.
4. Start the backend. If there are no accounts, it creates **admin** with the
   supplied password, once. If the secret is absent, the login page explains setup
   is required. Restarts never reset accounts or passwords.
5. Sign in as **admin**, change the temporary password, then sign in again.
   Remove the bootstrap secret after successful initialization. Share new-user
   temporary passwords only through the client's approved secure channel.

Secure cookies are enabled by default, including the HTTPS development preview.
`CC_COOKIE_INSECURE=true` is **only** for isolated HTTP loopback tests; never set it
in a published or client deployment. Restrict direct backend ingress, serve the
frontend/API on one HTTPS origin, and preserve the original Host header in the
reverse proxy. Unsafe requests require matching Origin and a session CSRF token.

## Roles and permissions

- **Admin:** all assessment actions and exclusive access to user management.
- **Developer:** all assessment actions, no user administration.
- **Reviewer:** view and export, no edits by default.

Admin can create accounts, change roles, grant/revoke individual assessment
permissions, deactivate/reactivate accounts and issue temporary password resets.
Permission identifiers are `view`, `evidence`, `run`, `notes`, `classify`,
`baseline`, `ai.generate`, `ai.accept`, `ai.remove`, `export`, `restore`, `reset`.
Admin permissions are fixed; granular grants cannot confer account administration.
Viewing is a prerequisite for assessment APIs. A reviewer can open a demo or
backup for read-only inspection without persisting it over their workspace.

New/reset passwords require change before assessment access. Password changes and
resets revoke all sessions; deactivation does too. Existing sessions read current
roles/permissions on every request. At least one active Admin must remain.
Sessions expire after eight hours; login and password attempts have database-wide
rate limits. Account changes are serialized to prevent last-Admin races.

## Storage and safety boundaries

PostgreSQL stores salted scrypt password hashes, account permissions, hashed session
tokens, CSRF tokens, login throttling counters and security audit events. Passwords
are never retrievable. Credentials and assessment contents are not logged in audit
events. Account data must be included in the client's database backup policy.

Assessment work stays in browser storage scoped by authenticated account identity.
This does not provide cross-device synchronization or cross-user collaboration.
Browser-local permissions are a UI workflow guard, not DRM: users with local
browser/device access can read or modify local files/storage. Do not share browser
profiles on untrusted devices. Existing anonymous data is preserved for deliberate
Admin import rather than disclosed automatically on sign-in.

If every Admin loses access, use the client's restricted operations process to
reset an existing Admin's password hash using the application's password hashing
helper, require a password change and revoke that account's sessions. Do not delete
the account database to retrigger bootstrap, install a backdoor password, or change
passwords via ordinary application logs. Prefer a second authorized Admin and
secure temporary-password reset through User Management.

Expire/purge old session, throttle and audit records under the client's retention
policy; expired sessions are invalid regardless of cleanup. Audit tables contain
internal account identifiers, so treat them as restricted operational data.

## Verification

`pnpm --filter @workspace/api-server run test` includes password and permission
unit tests. Opt-in live database/API checks:
`CC_TEST_ACCOUNTS=true pnpm --filter @workspace/api-server exec tsx --test src/accounts.test.ts`.
They create uniquely named synthetic accounts and remove only their own accounts.
Do not run development tests against a production database.
