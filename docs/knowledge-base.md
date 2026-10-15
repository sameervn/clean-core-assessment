# Clean Core knowledge library

## Scope and access

This is a shared library for the authenticated users of **one deployment**, not a
tenant or organization portal. Only upload material those users may read.
Assessment evidence, classification, scoring, and deterministic solution rules
are unchanged. New/reset/demo assessment defaults are `S4HANA_2025`
(S/4HANA 2025); restored work and baseline targets are not migrated. The release
label does not assert new SAP-specific rules or live SAP validation.

Admins receive all permissions and administer grants in Users & permissions.
Developers default to `knowledge.read` and `knowledge.upload`: upload, replace,
and remove their own documents. Reviewers default to `knowledge.read` only.
`knowledge.manage-all` permits replacing/removing other users' documents;
new uploads/replacement registration also require `knowledge.upload`.
Knowledge endpoints require assessment `view` and a current local session.
Every request re-reads session and permissions; processing and downloads recheck
again at commit/serve time. Existing CSRF and same-origin mutation protection
remain mandatory. No public file route is mounted.

## Durable storage and client hosting

PostgreSQL holds document metadata, extracted text, version counters and a GIN
full-text search index. File bytes use a private GCS bucket, never PostgreSQL,
browser-only storage, the application filesystem, or Git. On Replit this uses
App Storage with the standard sidecar client and `PRIVATE_OBJECT_DIR`.
Missing storage configuration is a visible library configuration state, never
an ephemeral fallback. AI can remain disabled independently.

For client-hosted deployments:

1. Use the existing PostgreSQL deployment. Review/apply the additive knowledge
   schema in `lib/db/src/schema/knowledge.ts` through your migration process.
   Run `pnpm --filter @workspace/api-server knowledge:migrate` with an authorized
   deployment role to apply the idempotent additive initializer and singleton
   revision record. Runtime roles do not need DDL rights when already provisioned.
   After the core API starts listening it also attempts initialization in the
   background for development convenience. Failure logs a sanitized warning and
   leaves only unprovisioned knowledge operations unavailable; it never prevents
   core startup. Restrict migration rights according to client policy.
2. Provision a **private Google Cloud Storage bucket**, enable public-access
   prevention, and give the service identity object read/create/delete and
   signing rights only within the selected bucket/prefix.
3. Set backend `CC_KNOWLEDGE_STORAGE=gcs` and
   `PRIVATE_OBJECT_DIR=/<private-bucket>/<deployment-prefix>`.
   Configure Google Application Default Credentials through workload identity
   (recommended), or the host secret manager. Never put credentials in `VITE_`
   variables, source control or browser code.
4. Configure bucket CORS for the exact application's HTTPS origins, methods
   `PUT`, and request header `Content-Type`. Allow browser PUT of
   `application/octet-stream`. Do not make the bucket publicly readable.
5. Retain Node 24+, production dependencies, and the build-copied
   `dist/parser-worker.mjs`. Deploy database and object storage in approved
   regions; back up both consistently. Maintain session signing secrets across
   replicas. A bucket alone is not a backup.
6. Restart the API and verify an authenticated upload, restart survival, private
   download, replacement and deletion in staging. Test denied roles and CORS.

Upload authorization lasts five minutes and grants only PUT to a random staging
object. The API checks actual length (8 MiB maximum), downloads a pinned object
generation, parses it, then copies verified bytes to a new sealed private object
that never had a browser write URL. This prevents reusing a still-valid upload
URL to alter indexed content. The API serves sealed originals only through an
authenticated, current-version download endpoint with attachment disposition.
Never add generic public storage routes for this bucket.

Deleted/replaced chunks disappear transactionally from retrieval. Previous
sealed objects are deleted after commit; storage cleanup failures cannot restore
read access. The API runs conservative automatic cleanup hourly, starting within
one minute of startup. Apply the additive migration to provision its shared
cursor and latest report. The storage service identity also needs object-list
permission for the private deployment prefix.

Admins can open **Knowledge base → Upload cleanup**, preview the next batch,
then explicitly run it. GET/POST `/api/clean-core/knowledge/cleanup` require
an Admin session; POST also requires the existing same-origin/CSRF protection
and `{ "dryRun": true | false }`. Reports contain counts, not private object
paths. Dry runs do not delete, expire records, or advance the saved cursor.
The panel refreshes the last completed actual run every minute; failed runs
leave the previous timestamp unchanged and emit a sanitized server warning.

Each batch expires at most 25 awaiting-upload/failed registrations inactive
for over 24 hours, then scans at most 50 objects under this deployment's private
`knowledge/` prefix. Expired registrations are removed from the library; upload
the file again if it is still needed. Processing registrations are never expired
by cleanup. Existing interrupted-processing recovery must first make them failed.
Objects must have known generation and modification time older than 24 hours.
All remaining PostgreSQL references protect objects, even deleted-row references.
In particular, **referenced sealed files are never age-deleted**.

Reference checks, expiry and storage deletion share the library transaction
lock with upload processing/commit, replacement and removal. Sealed creation
and adoption also hold that lock. Generation-conditional deletes preserve an
object overwritten since listing. A storage failure is counted and revisited
on the next complete scan; the persistent page cursor wraps at the end.
Concurrent replicas serialize and share the hourly throttle. A database/list
failure aborts the batch without advancing the cursor. A crash after a storage
delete may under-report counts; reruns safely tolerate missing files. Manual
runs are rechecked, so their results may differ from a previous preview.
Never configure a bucket age-only lifecycle rule on sealed files.

The library caps live records at 500. Coordinate retention and backup policies with the client;
deletion from the app does not erase externally managed backups.

## Parsing and recovery

Supported formats: PDF, DOCX, UTF-8 TXT and Markdown. No OCR, arbitrary HTML,
scripts, macros, external document relationships, or internet fetching.
Limits: 8 MiB original; PDF 200 pages; DOCX 500 entries, 32 MB total expanded,
8 MB per entry; 400,000 extracted characters; 600 passages, 1,400 characters each.
Parsing runs in a killable child process (20 seconds, 128 MB JS heap), with no
provider/database/storage credentials. Deploy with host/container-level memory
and process quotas too; JS heap limits do not bound native parser allocations.
Encrypted, mismatched, corrupt, unsupported, over-limit, and textless/scanned
files produce explicit failures. DOCX citations use paragraph numbers; PDF uses
page numbers; Markdown uses headings where available.

States: awaiting upload, processing, ready, failed. Processing interrupted for
more than two minutes becomes a retryable failure when the library is read.
Replacement keeps the previous version usable until the replacement commits.
Version checks prevent concurrent replacements or deletions overwriting each
other. Failed replacement never removes the last good version.

## Retrieval, consent and historical citations

Search is local PostgreSQL full-text search, **not embeddings or live browsing**.
AI retrieval derives bounded lexical topic terms from the deterministic solution
identifier, filters on matching passage text, and prioritizes exact release,
then general, then other-release guidance. Topic tags boost matching passages.
At most four passages (two per document, 5,600 text characters total) are sent.
Irrelevant release tags alone do not qualify a passage.

This is intentionally conservative lexical retrieval, not proof of exhaustive
coverage or semantic policy consistency. Short/missing/other-release-only
guidance is labeled insufficient. Opposing directive language across documents
gets a potential-conflict warning; experts must inspect actual applicability.

Users choose knowledge-base-only (default) or explicitly permitted, labeled
general-model fallback. Knowledge-only cannot generate without sufficient
applicable excerpts. In that mode the model is instructed to report gaps instead
of supplementing them. Fallback is not internet research.

Preview makes no provider call. It displays the exact assessment summary
(including selected target), source titles/versions/sections and bounded text
that the configured OpenAI/Azure provider will receive. The five-minute consent
token binds user, provider/model/destination, summary, policy, exact retrieval,
and library revision. The server recomputes retrieval and rejects any mismatch;
replacement, deletion or a new indexed document requires a fresh preview.
Shared database read locks keep the retrieval version stable through generation.
Uploaded instructions are untrusted reference data; no tools execute them and
they cannot mutate scores. Provider/limiter safeguards remain in place.

Accepted explanations store historical citation metadata, policy and disclosure,
but not excerpt copies. Current-version excerpts remain inspectable in the UI.
Deleted/replaced sources show `stale-source` and have no old-content link.
Exports with cited accepted explanations check current library versions with a
two-second deadline (including response-body reads). Exports without citations
make no library request. Timeout, offline or denied access is explicitly
`unverified`, never silently current. Backups preserve citation metadata and
accepted text; they are not document-library backups. Existing AI text may itself
quote guidance and is not retroactively erased on source deletion.

## Verification

`CC_TEST_KNOWLEDGE=true pnpm --filter @workspace/api-server exec tsx --test src/knowledge-cleanup.test.ts`
checks real PostgreSQL lock serialization and reference protection in an isolated
temporary schema, with synthetic storage (no real files deleted), plus dry runs,
failed deletes, expiry bounds, scan cursors and competing scheduled workers.

`pnpm --filter @workspace/api-server test` runs synthetic parser, consent,
permission and provider/limiter tests without external AI requests.
`CC_TEST_KNOWLEDGE=true pnpm --filter @workspace/api-server exec tsx --test src/knowledge.test.ts`
also checks real PostgreSQL indexed retrieval, cleaning up only its synthetic rows.
`CC_TEST_KNOWLEDGE=true pnpm --filter @workspace/api-server exec tsx --test src/knowledge-integration.test.ts`
checks real private uploads, ownership, replacement/deletion and a mocked
provider through the actual preview/consent routes. It needs development storage,
not production. No real AI provider smoke test is implied.
