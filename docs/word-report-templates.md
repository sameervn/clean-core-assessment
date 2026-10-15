# Private Word report templates

Word templates control **downloaded DOCX reports only**. Existing assessment screens,
JSON, CSV, Markdown, XLSX, PDF, PPTX and recovery backups are unchanged. No rendering
step calls an LLM or third-party converter.

## Authoring

Open **Account → Word report templates**, download the built-in sample, edit in
Microsoft Word and save as ordinary `.docx`. Keep your tables, styles, page settings,
headers/footers and embedded PNG/JPEG branding. Insert plain tags such as
`{entity_id}` and `{entity_kind}` (both required). Word may split a tag across runs;
this is supported. Arbitrary untagged documents are rejected rather than inferred.

Available scalar tags:

`entity_id`, `entity_kind`, `entity_name`, `entity_type`, `package`, `owner`,
`source_system`, `target_system`, `target_release`, `classification`, `severity`,
`rationale`, `mitigation`, `evidence`, `notes`, `ai_explanations`.

Use braces around each name. For repeated findings, place
`{#findings}{text}` in the first cell and `{severity}{/findings}` in the last cell of
the **same table row**. That row repeats. Recommendations can use
`{#recommendations}{text}{/recommendations}` in a paragraph or table row.
Loops cannot nest; expressions, conditions, raw XML, scripts and dynamic images
are not supported. Literal report values are escaped, not interpreted as tags.
Missing values read **Not provided**, inapplicable fields **Not applicable**.
AI text is only previously accepted content, with citations, acceptance attribution,
assessment-review status and source-freshness labels. Unknown source versions
are labelled unverified, never current.

Upload and name your template, download a fictional populated preview, inspect it
in Word, then choose **Make default**. The preview is a download, not a claim of
pixel-identical rendering in every Word-compatible viewer. Replacing a template
clears its preview/default flags; preview and activate the new version. Deleting a
default leaves no default. The built-in sample is always an explicit choice, never
a hidden fallback for a failed selected template.

## Supported layout and safety limits

- Standard UTF-8 WordprocessingML DOCX only; 4 MB compressed, 20 MB expanded,
  300 archive entries, 2 MB per XML part, 1,000 tags.
- No macros, encryption, OLE/embedded documents, external relationships (including
  hyperlinks), remote images, VML, fields, content controls, tracked changes,
  charts, custom XML or executable expressions. Convert legacy VML logos to
  embedded PNG/JPEG DrawingML, remove links and accept tracked changes first.
- 20 templates per account including pending uploads; abandoned uploads expire
  after one day and are cleared on the next upload.
- At most 50 unique selected entities, 200 findings/recommendations per entity,
  2 MB request data and 40 MB archive output. A report's expanded output is limited
  to 20 MB. A worker is killed after 20 seconds or its 192 MB V8 heap limit.
  Two workers per API process; excess requests receive a retryable error.
- Every requested entity must exist. Objects that are also interfaces produce one
  interface report, retaining accepted explanations for both identities. ZIP names
  have an ordinal prefix, so sanitized names cannot collide.
- Cancellation aborts processing and produces no download. A failed batch produces
  no partial archive. Smaller selections are required when a limit is exceeded.

## Authorization and deployment

Admin and Developer default to `templates.manage`; Reviewer defaults to export
using the explicit sample. Admin can grant Reviewer personal template management
or revoke it from Developer. Owners alone may access their uploaded files—even
Admin cannot read another account's private template by guessing an identifier.
Export permission is checked on each generation request and again before sending
the output, including previews. Assessment data stays in the existing browser
workspace and is sent only to this application's server for rendering.

Configure the existing PostgreSQL connection and private App Storage
`PRIVATE_OBJECT_DIR`. Replit uses the existing storage client; client-hosted GCS
uses `CC_KNOWLEDGE_STORAGE=gcs` and workload identity/ADC as documented in
`knowledge-base.md`. There is no local-filesystem or public-storage fallback.
Allow signed PUT CORS from your deployment origin. Apply the additive report
migration with `pnpm --filter @workspace/api-server exec tsx scripts/migrate-reports.ts`
if the runtime DB role cannot create tables. The API also initializes tables
idempotently at startup.

Template metadata lives in `cc_report_templates`; bytes use
`PRIVATE_OBJECT_DIR/report-templates/<owner>/...`. Neither is part of knowledge
ingestion, retrieval or knowledge cleanup. Upload bytes are read from a pinned
storage generation, validated in a credential-free child process, then copied
to an immutable sealed object. Only sealed templates render.
Replaced/deleted objects are queued separately for retryable deletion; staged
uploads wait longer than the signed PUT lifetime. Database backups must include
template metadata and garbage queue, and private object storage must be retained
across restarts. Deploy the server's report worker files and runtime dependencies
`docxtemplater`, `pizzip`, `yauzl`, `fast-xml-parser` (the build copies worker files).
Word/ZIP packages are server-only and never enter initial browser startup.

Tests: `pnpm --filter @workspace/api-server exec tsx --test src/reports.test.ts`.
Optional real database/storage lifecycle tests:
`CC_TEST_REPORTS=true pnpm --filter @workspace/api-server exec tsx --test src/reports-integration.test.ts`.
