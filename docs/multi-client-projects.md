# Multiple clients and parallel projects

## User workflow

An installation contains **clients → projects → assessments**. An Admin creates
clients/projects in **Clients & projects**, then explicitly assigns existing
accounts. The creator is assigned to a new project; nobody else is automatically
added. Global Admin, Developer and Reviewer roles and permission overrides remain
unchanged. Project membership is an additional boundary; shared assessment
membership and reviewer assignment are still required.

Admins are trusted **platform administrators**: they can manage all client/project
metadata and account assignments. This is not a separate client-admin role.
Admin role alone does not open unassigned project content. Do not give client
users Admin if they must not administer other clients' memberships.

Project selection belongs to the current browser tab and signed-in user.
Separate tabs can open different projects concurrently. A visible scope bar
identifies the active client/project. Switching cancels old requests, remounts
scoped screens and uses separate persisted drafts; it does not copy assessments.
New projects start empty and can load their own demo evidence.

GitHub credentials, knowledge libraries, company report defaults and personal
templates are **project-specific**, with credentials/personal templates also
account-private. Connecting a repository in one project does not connect it in
another. There is no implicit cross-project knowledge or template sharing.

## Server boundaries

All `/api/clean-core`, `/api/shared-assessments` and `/api/report-templates`
requests require `X-CC-Project-ID`. The server resolves this identifier using
current authenticated membership; it never defaults a missing header to another
project. Unassigned project IDs, object IDs from another project and removed
memberships cannot open product data.

Project data uses separate PostgreSQL schemas. Each scoped connection has
exactly one application schema in its search path, **without a public fallback**.
Filtered identity/session views expose only accounts assigned to that project
to existing reviewer and account lookups. The connection is reset before release.
Client/project catalog, platform accounts, sessions and minimal administration
audit events remain in the control-plane public schema.

New files use a project-specific prefix beneath the existing private storage
root. Reads/deletes verify the active prefix; cleanup enumerates only that
project's prefix. Signed create-only uploads bind project and account and
recheck membership before writing. Evidence attestations, AI consent signatures
and saved GitHub credential encryption contexts are project-bound.

This is application/database-namespace isolation, **not a separate database,
encryption master key, infrastructure account or geographic region per client**.
The trusted application service/database administrators and infrastructure backups
can span projects. Clients requiring physical, key or residency separation need
separate deployments. Existing client-hosted PostgreSQL/RDS and persistent-volume
file storage remain supported; no S3 bucket is introduced.

## Existing data and migration

The client migration preserves existing domain tables and their rows by moving
them transactionally into **Legacy workspace** under **Legacy client — assign
before client use**. It preserves references, revisions, approvals and existing
file paths; it does not copy or delete them. Only active Admin accounts are
initially assigned to this workspace. Existing assessment-level membership is
preserved but does not bypass the new project membership boundary.

An Admin must identify the actual client, rename/reassign the legacy project,
and explicitly assign the appropriate accounts. Reassignment moves the **entire**
workspace, including its knowledge, credentials and templates, without altering
membership. It does not split mixed historical data between clients.

Existing per-user browser workspaces and shared-editor recovery keys are
available only in the legacy project. New projects use new namespaces and never
automatically import legacy or anonymous browser data. Explicit backup imports
are a user-directed transfer; verify the active project before importing.
Evidence signatures are project-bound: rerunning evidence imported from a
different project requires uploading the original evidence files into the
target project. Restoring a backup does not re-sign another project's evidence.

AI provider, model and gateway environment settings remain deployment-wide.
Confirm that the configured processing route is approved for every client using
AI. Use separate deployments when clients require different provider credentials,
regions, infrastructure or encryption keys; project scoping does not provision
separate AI-provider tenants.

Back up PostgreSQL **and** private storage before upgrading. Run the existing
client migration before `CC_SCHEMA_BOOTSTRAP=false` startup. Older standalone
knowledge/report migration commands now invoke the project-aware migration and
must not recreate product tables in public.

Admin project creation queues a pending request using DML only. A separate
operator-managed provisioner owns schema setup; only ready projects can be opened
or processed by background workers. Setup, identity views and runtime grants commit
atomically. Failures roll back all setup and leave a failed request with sanitized
status; Admins can retry after operator correction or cancel an unfinished request.
See [the role, migration and job runbook](../deploy/PROJECT-PROVISIONING.md).

## Operations and limits

Schema upgrades apply to every ready project (pending requests use the current
provisioner image when processed). Background notification delivery and
file cleanup run inside each project's scope; SQL and file-store backups must
include every project namespace/prefix, not just public or legacy data.

Project/member administration writes minimal control-plane audit records.
Do not manually change schema names or move storage files. No project/client
delete or per-client purge workflow is provided by this change; retention,
backup expiry and end-of-engagement erasure still require an agreed operator
procedure covering browser copies and downloaded artifacts.

Browser storage is not a security boundary against a device owner: previously
downloaded code, browser drafts and exported reports may remain on that device.
Use approved managed devices/browser policies for sensitive multi-client work.
