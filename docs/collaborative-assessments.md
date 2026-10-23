# Shared assessment review

## Storage and deployment

Shared review is opt-in: publish a browser assessment after downloading its backup.
Publishing does not replace or synchronize the local browser workspace. Repeating
the same owner/import identity returns the existing shared assessment. Publish is
limited to 5,000 objects/interfaces and 8 MB; raw browser evidence is explicitly
labelled publisher-supplied, not independent certification.

Run the existing client migration (`artifacts/api-server/scripts/migrate-client.ts`)
with the deployment migration identity before starting with
`CC_SCHEMA_BOOTSTRAP=false`. It creates the additive shared assessment, membership,
revision, event, approval, company template and connection tables. Kubernetes/RDS
continues to use PostgreSQL for metadata and the existing private storage backend
for source, template and sealed approved report bytes. All replicas need the same
RDS database and storage configuration; local file mode requires a persistent,
shared volume, never an ephemeral container directory. Back up the database and
private file store together. Do not delete historical company templates or source
files referenced by revisions.

One client deployment represents one company. Company templates are shared with
authenticated users in that deployment; private templates remain account-owned.
This is not a multi-company SaaS tenant boundary.

## Roles and review

Administrators grant explicit read, editor or reviewer membership. Admin role
alone does not expose assessment content. Editors must be Developers or Admins
with classification permission. Reviewers must have Reviewer or Admin role and
be assigned to the item. Developers submit; the assigned independent reviewer
can edit the narrative, approve, or request changes with a comment. Reviewers
cannot approve their own submissions. Other changes require the developer.

Every edit, assignment and transition advances the revision. Stale requests fail
with HTTP 409; keep the draft and compare with the latest revision before retrying.
Action retries with the same request ID and identical payload are idempotent.
Changing approved content or source starts a new draft; past approvals remain
available and are labelled superseded.

Approval requires a previewed company default DOCX. The report is rendered and
sealed before the database transaction commits, so a rendering/storage failure
does not approve the item. Approved downloads use those sealed bytes, never later
drafts or replacement templates. Batches are all-or-nothing, at most 50 reports
and 40 MB. Download authority is checked against current membership and export
permission.

## Approved archive navigation

The archive has no 5,000-record listing ceiling. It loads 50 approvals per page
(API maximum 100), newest first, with approval ID as the timestamp tie-breaker.
Search, record type, and superseded visibility are applied on the server before
paging. Search covers record name, assessment, approver, UTC timestamp and version;
percent and underscore characters are literal, not wildcards.

Previous/Next navigation retains its upper cursor boundary so newly arriving
approvals do not shift it forward. Refresh starts at the newest approvals.
Cursors are bound to the user and filters, not a grant of access: every request
checks current membership. This is a live archive, not a frozen database snapshot;
current superseded status and membership changes still apply while browsing.
Selections survive page and filter changes but remain limited to 50 reports,
independently of archive size. Historical sealed reports are not regenerated.

## GitHub

An administrator configures `CC_GITHUB_TOKEN` securely and the comma-separated
`CC_GITHUB_REPOSITORIES` allowlist. Use a fine-grained GitHub token restricted to
Contents and Metadata read-only on those repositories. Users explicitly connect
this configured service access; this is not personal GitHub OAuth. Disconnect
disables subsequent fetches for that account, without deleting immutable evidence
already included in a review. Rotate/revoke the token at GitHub to revoke the
underlying service credential.

Only GitHub.com HTTPS read endpoints are used; redirects are rejected. Ref lookup
resolves to immutable commits, files are explicitly mapped, and blob identity and
SHA-256 are checked. Files are bounded to 256 KB each, 10 per entity; repository
trees over 10,000 entries, truncated trees, and responses over 2 MB fail explicitly.
There is no repository write, code execution, remediation, or PR creation.
Source evaluation is a conservative lexical proposal, not an ABAP compiler or
SAP release certification. It retrieves uploaded guidance first and displays
passages, versions, release applicability and explicit gaps alongside its bounded
lexical findings. It never auto-applies changes and never sends source
to AI. Existing optional AI explanations retain their knowledge-first consent
flow and Deere backend routing.

## Complexity and usage

Complexity size is distinct from Clean Core compliance scoring. The deterministic
legacy nonnegative metric mapping is: XS 0–5; S >5–10; M >10–20; L >20–30;
XL >30–40; XXL >40. Missing, negative and non-finite measurements are Unassessed.
Explicit manually selected sizes take precedence; raw imported metrics are
technical evidence, not a substitute compliance score.

Positive observed executions mean In-use. Not in-use requires explicit zero for
every supplied usage row, `telemetryCoverage=100`, and valid collection start/end
with end after start. Required-field completeness (`metadata.coverage`) is not
telemetry coverage. Missing or inconclusive observations stay Unknown. Zero use
only describes the observation period, not a guarantee that retirement is safe.
