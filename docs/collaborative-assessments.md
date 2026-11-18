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

The tool supports multiple clients and projects in one installation. Select an
assigned project before opening assessment tools. Knowledge, company templates,
GitHub connections, source snapshots, review records and exports are isolated
per project, even for projects under the same client. Private templates also
remain account-owned. See [Multi-client projects](multi-client-projects.md) for
the migration, access model and operational requirements.

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

## Direct source-file uploads

Both source ingestion methods are available: **Map GitHub source** and direct
**Upload source file**. In Object Explorer or Interfaces, open a record and use
its **Source code** section. Shared assessment record details offer the same
upload control. Do not upload raw ABAP code through **Upload Evidence**, which
expects inventory, ATC, usage or interface evidence records.

Select a UTF-8 `.txt` or `.abap` file, click **Review upload**, verify the target
record, filename and sharing disclosures, then confirm. Files may contain an
annotated method extract or complete ABAP source; their names and headings do
not automatically establish object identity. Select the corresponding
implementation class/object or interface explicitly.

- Maximum file size: **256,000 bytes**; one file per confirmation.
- At most **ten source files per record**, counting GitHub and uploaded files.
- Empty, whitespace-only, invalid UTF-8, binary/control-character content and
  unsupported filenames are rejected before durable storage.
- An upload with the same filename replaces only that record's previous upload
  with that name. It does not replace an identically named GitHub file.
- Each successful attachment creates a new **Draft** version; narrative,
  classification and recommendations remain unchanged. Submitted/Approved
  records need a new review, while historical snapshots and approved exports
  are retained.
- Uploaded provenance includes filename, SHA-256 checksum, byte count, upload
  time and uploader ID—not a fabricated repository or Git commit.
- Source viewing and explicit deterministic evaluation use the same
  project/assessment membership checks as GitHub snapshots. Uploading code does
  not execute it, send it to an LLM, or automatically apply findings.

Admin/Developer editors need **Classify** and **Load evidence** permissions.
Local uploads do not require a GitHub connection or new environment variables.
They use the existing private storage backend, including the client local/PVC
deployment option; no S3 bucket is required.

## GitHub

Open **GitHub Connections** in the main assessment workspace navigation to see
connection status and add, replace or remove your own repository connections.
The same panel is available in Shared assessments. Connecting requires Admin or
Developer with evidence permission. The tab is available before running an assessment.

Enter `owner/repo` or an HTTPS GitHub.com repository URL, your GitHub username
and a fine-grained personal access token (`github_pat_...`). GitHub account
passwords and classic broad-scope tokens are not accepted. Restrict Contents and
Metadata to read-only for only the required repositories; organization approval
may be necessary. The backend verifies token ownership, exact repository access
and Contents-read access before saving. Failed verification preserves the prior
connection. Up to 100 repositories can be saved per account, each with its own
credential. No GitHub variables in `.env` or Replit-specific OAuth are required.

Tokens are encrypted in PostgreSQL with AES-256-GCM using a domain-separated
HKDF key derived from the existing `SESSION_SECRET` (at least 32 characters).
The authenticated context binds the ciphertext to the app account, repository
and GitHub username. Maintain this secret securely and consistently across
replicas; rotating or losing it requires users to reconnect their repositories.
The server never returns saved tokens, the form never prefills them, and inputs
are cleared after each submit. Do not put tokens in workspace backups, audit
payloads, logs or exported assessments. Normal database backups include encrypted
credentials, so their retention and encryption remain part of client operations.
Previously configured environment-based service access is no longer used;
existing source snapshots remain, and users must add their own connections.

Remove deletes that account's saved credential and disables subsequent fetches
for the repository, without deleting immutable evidence already included in a
review. It does not revoke the token at GitHub; revoke it there separately if
needed. Other accounts cannot use or list these connections, including Admins.
Connection status confirms local decryptability, not live token expiry: GitHub
revocation, expiry, denied access and rate limits fail explicitly on reads.

Only GitHub.com HTTPS read endpoints are used; redirects are rejected. Ref lookup
resolves to immutable commits, files are explicitly mapped, and blob identity and
SHA-256 are checked. Files are bounded to 256 KB each, 10 per entity; repository
trees over 10,000 entries, truncated trees, and responses over 2 MB fail explicitly.
There is no repository write, code execution, remediation, or PR creation.

### Link source from an assessment record

Open an object in **Object Explorer** or an interface in **Interfaces**, then use
**Source code → Map GitHub source**. An Admin/Developer needs both Load evidence
and Classify permissions. Choose one of your saved repositories and its branch,
tag or commit, then select **Find files**. Exact ABAP/abapGit name/type matches
(including encoded namespaces and class includes) are suggested. Different
folders or groups without a main file require explicit selection; unmatched
records are never assigned unrelated code. Manual file selection is available.
Only the first 300 matching file-list entries are displayed; filter by path to
find additional files. Review all selected paths before confirming.

Mapping does **not** require a reviewer or an approval submission. The app saves
only the selected record to an owner-private server assessment if none exists.
If that assessment already has members, confirmation discloses their access and
requires acknowledgement. No membership is granted implicitly. Existing server
content is not overwritten from a different browser snapshot. Record identity
uses the workspace assessment plus record kind/key, not the object name alone.

The confirmation freezes the selected repository, commit, files and record
revision. Changed membership or record state requires a new confirmation. Source
files are staged and committed as one revision, so one failed file leaves the
prior group unchanged. Attaching or refreshing source returns a submitted or
approved record to **Draft**; previously approved exports and historical source
snapshots remain intact. Narratives, classifications and recommendations are
not changed by mapping. Save or discard unfinished edits before mapping.

After linking, opening the record automatically displays its first saved file.
Use **Source file** to switch between files; repository/path/commit provenance is
shown. The viewer is read-only text (not executable HTML), displays at most
4,000 lines / 200,000 characters, and retrieves source only when a record is
opened. Reloading retains the associations. Authorized shared-assessment members,
including reviewers without GitHub credentials, can read the saved snapshots.
Read-only browser backup previews do not query server-owned associations.
Removing or expiring a GitHub credential stops new reads from GitHub, not access
to existing assessment snapshots. Use **Re-map GitHub source** and Find files to
explicitly refresh a snapshot from another commit.

Source evaluation is a conservative lexical proposal, not an ABAP compiler or
SAP release certification. It retrieves uploaded guidance first and displays
passages, versions, release applicability and explicit gaps alongside its bounded
lexical findings. It never auto-applies changes and never sends source
to AI. Existing optional AI explanations retain their knowledge-first consent
flow and Deere backend routing. Evaluation is separate from mapping: use
**Rule check (no AI)** in Shared assessments to request an unaccepted proposal.
Knowledge permission is required for that check, not for mapping source.

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
