# Clean Core Assessment

A standalone SAP Clean Core assessment product extracted from a user-provided Code-Remediator source archive. The original project is never changed or called at runtime.

## Run & Operate

- Managed backend workflow: `artifacts/api-server: API Server` — assessment API at `/api`
- Managed frontend workflow: `artifacts/clean-core: web` — assessment at `/`
- `pnpm --filter @workspace/api-server run test` — original engine/attestation tests plus evidence parsing checks
- `node scripts/src/verify-clean-core.mjs` — API smoke checks against the running proxy
- `node scripts/src/verify-clean-core-exports.mjs` — exercise frontend export handlers and backup validation with the original demo
- `pnpm --filter @workspace/clean-core run check:bundle` — build production JS in memory, check export-library isolation and startup size budgets (no running API or browser required)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Client security finding inventory, advisory evidence, request budgets and acceptance rerun: `docs/client-security-remediation.md`.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required server secret: `SESSION_SECRET` — evidence-integrity signatures; never expose it to the client
- Local accounts require PostgreSQL (`DATABASE_URL`); assessment evidence/workspaces remain browser-local, separated by account.
- Initial account: username `admin`; supply a strong `CC_BOOTSTRAP_PASSWORD` secret (14–128 characters) for first startup. Mandatory first-login password change. Never hardcode or log this password. See `docs/local-accounts.md`.
- Optional client-hosted AI explanations are disabled by default. Local session authorization is the default; explicit gateway mode adds signed assertions. See `docs/client-ai.md`. No Replit AI proxy is required.
- New and reset assessments default to S/4HANA 2025; saved targets are not migrated. The authenticated shared Knowledge Base uses private durable GCS/App Storage plus PostgreSQL metadata/text indexes. See `docs/knowledge-base.md` for client setup, limits, permissions, consent and source-version handling.

## Startup bundle regression gate

`artifacts/clean-core/scripts/check-bundle.mjs` uses the actual Vite production
configuration and Rollup output metadata. It walks every entry's transitive
static imports, deduplicates shared chunks, and excludes dynamic imports.
Module identities (not hashed filenames) must show `pdf-lib`, `pptxgenjs`, and
`write-excel-file` in the production output but never in the initial static graph.
Missing entries, unresolved static imports, and missing generators fail closed.

`artifacts/clean-core/bundle-budget.json` caps the sum of minified startup JS at
970,000 raw bytes and 285,000 gzip bytes. The initial measured baseline was
916,617 raw / 266,735 gzip bytes; these limits allow roughly 6% headroom for small
changes while catching material regressions. Gzip is measured per emitted chunk
with Node's default compression, then summed; it is a repeatable estimate, not
a claim about server transfer settings. CSS, images, and lazy chunks are excluded.
The command includes isolated graph/budget regression tests and does not write
to `dist` or change the running preview.

When the gate fails, inspect its per-chunk size table and offending module
messages; restore lazy imports or reduce startup dependencies first. Change the
checked-in budget only after an intentional, documented baseline review, and
lower it after substantive startup reductions rather than automatically ratcheting
it upward. This gate is independent of export behavior and saved-work browser tests.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Workspace storage: browser IndexedDB, with downloadable backups; no cross-device synchronization
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/clean-core/` — standalone assessment interface, browser persistence, and report exports
- `artifacts/api-server/src/clean-core-assessment.ts` — original, unchanged classification/scoring/parser/demo engine
- `artifacts/api-server/src/routes/clean-core.ts` — standalone validation and assessment routes
- `artifacts/api-server/src/evidence-attestation.ts` — original canonical HMAC attestation
- `lib/api-spec/openapi.yaml` — standalone API contract

## Architecture decisions

- Preserve original domain rules and recognizable UI instead of recreating a similar product.
- Browser-local persistence avoids retaining assessment evidence on the server. Evidence is transiently processed by authenticated, permission-checked backend routes.
- No project/user selection, remediation editor, auto-fix, migration portfolio, GitHub integration, general analytics/history/rules/settings, knowledge base, or global source administration.
- Do not present the old canned conversational UI as AI. Recommendations are deterministic and evidence-derived.

## Product

Evidence upload/normalization; 4,000-object synthetic demo; classification and scoring; inventory and interface detail; recommendation rationale/confidence; mitigation roadmap; evidence quality/provenance; overrides, narratives and baseline comparison; JSON, CSV, Markdown, XLSX, PDF and PPTX exports.

## User preferences

Keep this application ONLY a Clean Core assessment product. Do not alter or create runtime dependencies on Code-Remediator.

## Gotchas

- Uploads: UTF-8 XML/JSON/CSV/TSV/TXT, max 16 MB/file, max 16 MB combined normalized evidence, max 20,000 combined rows.
- Evidence attestations must verify before scoring. Rotating `SESSION_SECRET` requires evidence re-upload; do not re-sign arbitrary client-supplied normalized evidence.
- Browser storage is not a backup; clearing site data removes it. Export workspace backups before moving browsers or clearing data.
- The uploaded source archive includes unrelated configuration and Git history: never deploy it or copy its secrets/configuration. It is ignored by Git and deployment.
- Codegen's Headers.entries and Blob types require DOM.Iterable / DOM libs in generated-client/schema packages.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
