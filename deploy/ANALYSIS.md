# Client deployment analysis

## Initial inventory (before application edits)

The application is a pnpm workspace. Observed runtime: Node 24.13.0,
pnpm 10.26.1; TypeScript 5.9.3, React 19.1.0, Vite 7.3.6,
Express 5.3.0, Drizzle 0.45.2, pg 8.23.0. Replit selects Node 24,
Python 3.13 and PostgreSQL 16. Python is not an application runtime.

Build API: `pnpm --filter @workspace/api-server build`.
Start API: `pnpm --filter @workspace/api-server start` (dist/index.mjs).
Build UI: `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/clean-core build`.
Development uses separately managed API and Vite workflows. API binds port
8080 through its artifact configuration; frontend requires PORT and BASE_PATH.
Root checks: `pnpm typecheck`; API tests: `pnpm --filter @workspace/api-server test`.

## Persistence and services

- Standard PostgreSQL via DATABASE_URL: accounts, sessions, audit, throttling,
  knowledge metadata/chunks and personal template metadata/garbage queue.
- Local Admin/Developer/Reviewer authentication, not Replit Auth or OIDC.
  No authentication replacement is needed.
- Replit object storage signs through localhost:1106 and accesses GCS.
  Native GCS is already selectable with CC_KNOWLEDGE_STORAGE=gcs using ADC.
  PRIVATE_OBJECT_DIR is `/bucket/prefix`. No disk fallback currently exists.
- Knowledge reads pin GCS generations; sealing uses create-only writes.
  Cleanup enumerates 50 items at a time and conditionally deletes the observed
  generation. Personal DOCX templates reuse the same storage functions and
  use owner-specific paths, staged uploads and immutable sealed paths.
- Assessments and recovery drafts remain in browser IndexedDB/localStorage.
  Downloads are created in the browser. These must not move to PostgreSQL.
- Parser and report subprocess workers run alongside the API; PDF.js resources,
  DOCX libraries, browser fonts, HarfBuzz WASM and lazy exports must be packaged.
  Build output is written to dist; application file bytes currently go to cloud
  storage, not local durable disk.
- AI calls use direct HTTPS OpenAI `api.openai.com` or
  `<resource>.openai.azure.com`, not Replit-proxied AI. Model means OpenAI
  model ID or Azure deployment name respectively.
- Optional distributed limiter uses an HTTPS Redis REST endpoint configured
  by the client. Raw Redis TCP is not equivalent.
- No runtime SAP connection or email delivery was found. SAP evidence is uploaded.
- GCS egress includes storage.googleapis.com and credential-provider endpoints;
  Replit localhost sidecar is development/platform-specific. Client ADC egress
  depends on its configured workload identity.

## Environment inventory (names only; no secret values)

Runtime: DATABASE_URL, PORT, NODE_ENV, LOG_LEVEL, SESSION_SECRET,
CC_BOOTSTRAP_PASSWORD, CC_COOKIE_INSECURE, CC_KNOWLEDGE_STORAGE,
PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS, CC_AI_ENABLED,
CC_AI_PROVIDER, CC_AI_MODEL, CC_AI_API_KEY, CC_AI_ENDPOINT,
CC_AI_API_VERSION, CC_AI_AUTH_MODE, CC_AI_GATEWAY_PUBLIC_KEY,
CC_AI_GATEWAY_ISSUER, CC_AI_GATEWAY_AUDIENCE, CC_AI_LIMITER,
CC_AI_LIMITER_NAMESPACE, CC_AI_LIMITER_TOKEN, CC_AI_LIMITER_URL.

Build/platform: BASE_PATH, REPL_ID, PORT, NODE_ENV; Vite supplies BASE_URL
and DEV. Replit plugins are development tooling, not required production
services. DEFAULT_OBJECT_STORAGE_BUCKET_ID is platform configuration, not
a direct application read found in the initial inventory.

Test/tool-only: CC_TEST_ACCOUNTS, CC_TEST_KNOWLEDGE, CC_TEST_REPORTS,
CC_AI_REQUIRE_REDIS_TESTS, CLEAN_CORE_BASE_URL, REPLIT_DEV_DOMAIN,
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, SYNTHETIC_PASSWORD, REDIS_CLI_BIN,
REDIS_SERVER_BIN, PATH. NODE_TLS_REJECT_UNAUTHORIZED occurs in test guards;
TLS verification must never be disabled for client deployment.

## Verification and remaining work

### Changes and reasons

- Added explicit Azure Blob, version-enabled S3 and single-process local storage
  adapters, retaining GCS/Replit code paths. Portable uploads are signed,
  path-bound, five-minute app capabilities with create-only writes; reads and
  cleanup use native provider versions/conditions, never cloud-error fallback.
- Added optional compiled frontend serving, dependency-free liveness, bounded
  readiness, replica/limiter validation, secure production origin checks,
  explicit localhost cookie opt-out and graceful shutdown. No UI or business
  assessment behavior changed.
- Added configurable verified PostgreSQL CA trust and pool bounds; separate
  transactional additive migrations for current account/knowledge/template
  schemas; optional runtime DDL disabling for restricted app roles.
- Added pinned non-root production image, local Compose, Helm dev/prod/AWS,
  Azure external-infrastructure modules, CI scanning/SBOM samples and client
  operational documentation. Terraform state and local credentials are ignored.

### Verified results (2026-10-14)

- Both existing Replit app workflows start. `/api/health` and `/api/ready`
  return 200. The initial storage readiness attempt used bucket metadata,
  which Replit's identity denied; the final probe uses a bounded object listing.
- Root `pnpm typecheck` passes.
- API default suite: 61 tests, 55 passed, 6 opt-in tests skipped, zero failures.
  Includes local storage and mocked S3 contract tests (not AWS connectivity).
- Opt-in Replit account/knowledge/report suite: 61 tests, 60 passed, 1 skipped,
  zero failures. Verified signed guidance upload/retrieval, ownership and
  permissions, replacements/deletions, and personal Word template lifecycle
  using synthetic data. No real LLM calls were needed.
- A completion check found the old orphan-eligibility predicate accepted only
  numeric GCS generations. It now treats native version IDs as bounded opaque
  tokens and preserves reference/age checks and native conditional deletion.
  Targeted cleanup suite: 8 passed, 0 skipped/failures. Real PostgreSQL isolated
  schemas plus local disk and S3/Azure SDK doubles exercise expired registrations,
  dry runs, batch caps, file reclamation and stale-version protection.
- Final completion feedback identified missing migration opt-in in both CI
  release commands and PostgreSQL URL TLS overrides. Both CI commands now
  explicitly enable hooks (with required pre-existing migration identity).
  URL TLS override parameters are rejected, safe legacy sslmode values are
  normalized, and effective pg settings are verified. Three targeted TLS tests
  pass, including ssl=0 and uselibpqcompat bypass attempts and compatibility
  with Replit's development-only plaintext database URL; root type checks
  and chart checks pass after the fixes.
- Existing browser regression: 1 passed, authenticating a synthetic user,
  loading the 4,000-object demo, verifying reload persistence and backup export.
- Existing clean-core-bundle workflow passes its 7 tests and production bundle
  budget; lazy PDF/PPTX/XLSX generators remain outside initial JS.
- `bash deploy/check-helm.sh` passes dev/prod/AWS lint/render and secret,
  migration, ingress, network policy and HPA combinations plus unsafe scaling
  rejection checks.
- Terraform 1.9.8 container: `init -backend=false` and `validate` pass with
  azurerm 4.65.0; no plan/apply. Provider lock file retained.
- Root Docker build passes, including all parser/report workers and compiled
  frontend. Latest build: `docker build --network=host -t clean-core:verified .`.
  Host networking was needed after the nested builder's default DNS intermittently
  timed out downloading packages. This flag is a runner workaround, not runtime
  container networking configuration.
- Trivy/Syft image tags in CI were confirmed available. Actual scanning, SBOM
  generation, registry push and CI deployment were not executed.

### Container execution limitation and remaining manual actions

Compose image creation and PostgreSQL startup succeed, but this nested Docker
runner cannot execute container health checks: it reports an OCI namespace
entry failure (`setns`). Therefore fresh/upgrade migration preservation and
the complete read-only-root Compose API smoke are **not verified here**.
Run `node deploy/container-smoke.mjs` on a supported Docker/Compose runner;
it creates only disposable test data, checks migrations twice, login/password,
demo, uploads/sealing, Word previews, persistence and shutdown, then removes
its own test volumes. It never targets the workspace database.

Validate real Azure/S3/GCS credentials, private networking, TLS/CA rotation,
restricted app/migration roles and provider-specific races in a client-approved
test environment. Test ingress cookies/CSRF and body limits, OpenShift arbitrary
UID/PVC permissions, and HPA with the actual Redis REST service. Real AWS
connectivity has not been tested. Rerun Replit integration smoke after merge.
Review/pin client values and secret sourcing before enabling CI approvals.

Local durable atomic publication uses same-volume hidden staging records:
cross-filesystem `/tmp` renames cannot provide atomic publication. Parser scratch
uses `/tmp`; unpublished local staging records are documented for stopped-app
cleanup. Local shared-volume/multi-replica operation is explicitly unsupported.
The image is host-root only; existing Replit base paths are unchanged.
No infrastructure has been provisioned, image pushed or client cluster deployed.
