# Client Mend / CodeQL remediation

Verified locally on 2026-10-19. This is a remediation record for the **17 supplied
PDF reports**, not evidence that the client's scans have passed. No rules,
scanner paths, package identities or dependency names were hidden or suppressed.
No production deployment, client-repository changes or production attacks were
performed. No S3 bucket is required; the local persistent-volume backend remains
supported and was exercised.

## Finding inventory

Report names below omit only the upload timestamp suffix. Original locations
refer to the client's scanned revision; current mappings use symbols because
line numbers have shifted. **Resolved** means implementation and local
regressions passed, not that the remote alert has been closed.

| Supplied PDF | Original location | Current source-to-sink mapping / disposition | Change and local verification |
| --- | --- | --- | --- |
| Missing_rate_limiting | runtime.ts:41 | `productionFrontend` → static files / SPA `sendFile`. Genuine defect; not just a stale alert. | Shared static budget before both handlers. Adversarial regression exhausts both assets and fallback, checks 429 / Retry-After and health. |
| Missing_rate_limiting_2 | routes/report-templates.ts:34 | Personal template list → owner/company queries; inherits API identity middleware. Genuine missing general limit. | Pre-identity IP budget plus router account budget; expensive report budget. Account isolation regression and database-backed template lifecycle pass. |
| Missing_rate_limiting_3 | routes/knowledge.ts:47 | Detail → document and passage queries. Genuine missing general limit. | Ingress limit before identity and knowledge account budget before handlers. Actual production/fixture exhaustion regression verifies zero extra identity queries after exhaustion; knowledge lifecycle passes. |
| Missing_rate_limiting_4 | routes/knowledge.ts:29 | List/search → recovery UPDATE and bounded SELECT. Genuine missing general limit. | Same layered limits as detail; cleanup and processing also have smaller budgets. Production list, shared middleware and knowledge integration checks pass. |
| Missing_rate_limiting_5 | knowledge/fixture.ts:10 | Synthetic harness's unconditional identity lookup. **Non-production location**, but valid fixture gap, not a production false positive. | Same pre-identity IP limiter and portable-upload placement as production; identity now API-scoped. Actual fixture exhaustion and local knowledge upload/lifecycle checks pass. |
| Missing_rate_limiting_6 | app.ts:40 | Report location drift: old identity mount now sits after capability upload. Current `readIdentity` can query the session DB. Existing login/AI limits did not protect that work. | Recognized `express-rate-limit` middleware before upload parser, cookies, identity, JSON and multipart. Actual app test sends 601 requests with session-shaped cookies and rotating forged forwarding headers; exactly 600 identity lookups, then 429. |
| Polynomial_regular_expression_used_on_uncontrolled_data | custom-fetch.ts:29 | API base URL trailing-slash regex, configuration-derived rather than ordinary HTTP request data. Quadratic trimming pattern removed regardless of narrower reachability. | Backward linear scan and 8,192-character configuration cap. URL compatibility, all-slash and excessive-input regressions pass. |
| Polynomial_regular_expression_used_on_uncontrolled_data_2 | clean-core-assessment.ts:269 | Location drift to old XML attribute matching; evidence multipart bytes → UTF-8 → regex parser. Genuine parsing risk. | Streaming Saxes XML parser replaces block/attribute/child regexes. Malformed attributes, long names, deep XML, DTD and prototype tests pass. Equivalent format regression passes. |
| Polynomial_regular_expression_used_on_uncontrolled_data_3 | clean-core-assessment.ts:250 | Location drift to plain-text severity matching. Genuine overlapping whitespace/backtracking risk. | Two colon searches, string slices and severity allowlist; no regex search. Long crafted line finishes promptly, ordinary `Z: high: finding` remains equivalent. |
| Remote_property_injection | clean-core-assessment.ts:273 | Old XML child normalization → dynamic property assignment. Current scalar row output is allowlisted, but relying on that alone was insufficient. | XML records have null prototypes, forbidden keys rejected before assignment, shared normalized-key checks and recursive JSON/request checks. Child/prototype/JSON/CSV regressions pass; unsupported ordinary XML fields never reach normalized output. |
| Remote_property_injection_2 | clean-core-assessment.ts:270 | Same path through XML **attributes**. Genuine unsafe dynamic-write pattern even though header normalization already stripped underscores from `__proto__`. | Same defense; raw and normalized constructor/prototype/proto keys fail explicitly. Attestation canonicalization also uses a null-prototype accumulator and rejects prototype keys. Legacy attestation compatibility tests pass. |
| Type_confusion_through_parameter_tampering | portable-storage.ts:125 | Local `put`: production capability PUT already used octet-stream `raw` + `Buffer.isBuffer`; therefore arbitrary query values did **not** directly become bytes. Still a real adapter runtime-contract gap for other callers. | All portable puts and sealed storage require a nonempty Buffer, max 8 MiB, before byte length/use/forwarding. Local malformed types produce no files. Actual portable HTTP type/media/query/capability/oversize/sealing checks and local lifecycle pass. |
| Type_confusion_through_parameter_tampering_2 | portable-storage.ts:95 | Azure `uploadData` sink, same guarded production source; TypeScript alone did not enforce exported adapter types. | Same Buffer assertion before even obtaining Azure blob client; tests verify no backend calls for strings, arrays, objects, typed arrays, empty or oversized buffers. S3 is guarded too. |
| Incomplete_URL_substring_sanitization | reports/engine.mjs:78 | Not an outbound URL sanitizer: substring check for WordprocessingML namespace anywhere in document. Genuine semantic namespace/root-validation defect. | Namespace-aware parsing requires actual `w:document` root with exact namespace URI; rejects descendant `w` rebinding. Wrong URI suffix, comment-only URI, wrapper, unrelated binding and rebinding tests fail closed; ordinary company-style headers/footers/images and sample/render tests pass. |
| Insecure_temporary_file | deploy/smoke-api.mjs:19 | Fixed `/tmp/write-check` in disposable smoke script, not application upload persistence. Genuine predictable-file creation. | `mkdtemp` private random directory, exclusive `wx` file with mode 0600, nested `finally` cleanup. Tests check directory mode 0700, uniqueness, duplicate creation failure and cleanup on success/error. Container stdin runner embeds helper source, so no missing relative module in image. |
| Mend_License_Check_error | pymupdf 1.28.2 AGPL 3.0 | Usage audit found only optional PDF typography inspection script; not PDF.js evidence extraction or pdf-lib exports. Confirmed license-policy exposure. | Removed optional script, dependency and lock entry; updated typography instructions. Frozen lock checks, knowledge PDF parser tests and four real PDF export/typography tests pass. |
| Mend_Security_Check_error | pymupdf 1.28.2 / CVE-2026-82035; zod 3.25.76 via api-zod / CVE-2023-54404 | Dependency associations validated as described below; PyMuPDF advisory has an inconsistent structured range. Not silently labelled a false positive. | PyMuPDF removed; catalog migrated to Zod 4.6.7, regenerated Orval schemas with version 4, all workspace resolutions verified. Patched **bounded** array early-rejection test and request resource guards pass; all typechecks, focused contracts, account/review/knowledge/report flows pass. Audit has zero findings. Client scan must confirm package/advisory resolution. |

## Advisory verification (authoritative sources, 2026-10-19)

- [NVD CVE-2026-82035](https://nvd.nist.gov/vuln/detail/CVE-2026-82035)
  describes PyMuPDF **through 1.28.2**, with a path traversal in the CLI
  `extract_objects()` font branch and links upstream commit
  `b2c8f3a859fed35c379a44df566f770dc3e18605`. Its structured affected-products
  table instead says **<=1.8.2**, inconsistent with its own narrative and the
  supplied Mend association. Do not invent a fixed release from that table.
  The optional inspection script did not call the vulnerable font-extraction
  CLI, and the application never used PyMuPDF. Removing the package resolves the
  application's dependency/license exposure regardless of this range discrepancy.
  Ask the client/Mend for the precise package match/range if it remains reported.
- [NVD CVE-2023-54404](https://nvd.nist.gov/vuln/detail/CVE-2023-54404)
  identifies Zod through **4.6.5** and upstream fix
  `e06a510b6fc1e6e28e3201fd116ca2a76212f6be`.
  [Red Hat](https://access.redhat.com/security/cve/cve-2023-54404)
  independently describes unbounded invalid-array issue accumulation.
  [Upstream fix discussion](https://github.com/colinhacks/zod/pull/6652)
  explicitly states the size-gate fix applies to bounded containers;
  **unbounded containers are unchanged**. Therefore a version bump alone is
  not a complete resource-boundary defense.
  [Zod 4.6.7 release](https://github.com/colinhacks/zod/releases/tag/v4.6.7)
  is newer than the affected range. The installed implementation and regression
  confirm `.max(100)` on a 100,000-invalid-element array yields one size issue
  without parsing elements. No runtime `zod/v3` imports remain. General request
  collection limits protect generated schemas that have no maximum.
- Generated schemas were regenerated, not edited by hand. No package override
  disguises Zod; the workspace catalog and resolved lockfile contain 4.6.7.
  Supported v4 entrypoints are used by server, generated schemas and frontend.
  Normal strict request rejection, IDs, numbers and existing contracts were
  checked through unit/type/integration tests.

## Request limits and deployment semantics

All limits use fixed **60-second windows**, count successful and rejected
requests, and respond with **429**, JSON message and **Retry-After**:

| Layer | Key | Budget per minute |
| --- | --- | --- |
| All `/api` traffic, including capability uploads | socket/Express IP | 600 |
| Portable storage uploads, before raw-body parsing | IP | 30 |
| Evidence multipart uploads, before body processing | IP | 20 |
| Knowledge router (all list/detail/file/actions) | authenticated account, IP fallback | 120 |
| Knowledge processing | account | 10 |
| Knowledge cleanup | account | 5 |
| Personal template router | account | 120 |
| Personal sample generation and non-GET actions, including validation/render/preview | account | 20 |
| Company templates | account | 60 |
| Company template upload / preview | account, separate budgets | 10 each |
| Approval download / entity review actions (including approved DOCX generation) | account, separate budgets | 20 each |
| Static files **and** SPA fallback, before filesystem serving | IP | 600 |

Existing password-login and AI-specific budgets/consent/gateway behavior remain
unchanged. The early IP budget applies **before** session database access, not
just after sign-in. `express-rate-limit` is the middleware entrypoint so standard
Express security analyses can recognize it; remote CodeQL acceptance still
requires rerunning the query pack.

Each limiter stores at most **10,000 keys**. Existing budgets are never evicted
to make room for fresh attacker identities. Expired keys are reused/pruned; new
keys fail closed with 429 when capacity is full. No request-derived timers or
unbounded key collections are created. IPv6 addresses are subnet-normalized by
the limiter's `ipKeyGenerator`.

`trust proxy` is explicitly **false**. Neither `X-Forwarded-For` nor `Forwarded`
can change the limiter key. Behind a reverse proxy, clients intentionally share
the proxy socket's IP budget. This is conservative and may affect aggregate
throughput; account budgets still remain independent. Do not change trust proxy
to `true` or a hop count without a separately verified network topology and a
proxy that strips/overwrites forwarded identities. Client ingress should enforce
its own real-client IP budget at the trusted edge.

The default `CC_HTTP_LIMITER=local` stores are **process-local**, bounded and
dependency-free for the **one-process, one-replica local-volume deployment**.
Before enabling multiple replicas, HPA or API workers, select
`CC_HTTP_LIMITER=redis-rest`. Helm and startup reject scaling with local mode.
Declare workers per replica with `CC_API_WORKER_COUNT`; Helm supplies
`CC_REPLICA_COUNT` (HPA maximum). External process managers must declare their
actual worker count; the app cannot discover independently started copies.
Use shared mode for rolling-update overlap even when desired replicas is one.
Helm uses Recreate updates in local HTTP mode to prevent temporary overlap.
Local file storage still requires one process/replica.

Configure `CC_HTTP_LIMITER_URL` (HTTPS Redis REST command endpoint),
`CC_HTTP_LIMITER_TOKEN` (runtime Secret, never ConfigMap), and
`CC_HTTP_LIMITER_NAMESPACE` (1–80 letters/digits/underscore/hyphen). All workers
and replicas of an installation must use the **same namespace and limits**;
separate installations/environments need different namespaces. This may use an
existing Redis REST service, but HTTP keys are separate from `cc-ai` budgets.
Neither raw Redis TCP nor a per-node ingress limiter is an equivalent substitute.
No service is added to the default single-replica installation.

Each named layer has its own hash and expiry sorted set in one Redis Cluster
slot. One atomic Lua script uses Redis server time to expire subjects, admit
new subjects only below **10,000 keys per layer**, and increment fixed windows.
Live budgets are never evicted; new subjects at capacity get 429 until the
earliest slot expires. Counts saturate rather than overflowing. Subject keys
are SHA-256 digests, not raw account IDs/IPs. Idle hashes/sets expire after a
window; active layers remove expired subjects on each increment. Lua cleanup
work is bounded by the 10,000-subject capacity. Do not independently delete or
evict these keys: use a dedicated, adequately sized **noeviction** Redis service
so memory pressure fails closed instead of silently resetting budgets.

The endpoint must support EVAL, TIME, HGET/HSET/HLEN/HDEL/HINCRBY,
ZRANGEBYSCORE/ZREM/ZSCORE/ZCARD/ZRANGE/ZADD and PEXPIRE, scoped to
`cc-http:*` keys. Require trusted TLS and a dedicated token; redirects are
rejected, responses are capped at 1 KiB and requests time out after two seconds.
No automatic retries of uncertain writes and **no local fallback**: transport,
permission, malformed-response or backend failures return **503 / Retry-After: 1**
before downstream identity/body handling. Invalid configuration fails startup.
429 and draft-8 rate-limit headers retain their normal semantics.

Liveness bypasses every general limit. Readiness also bypasses quota admission
and makes a coalesced, read-only Redis TIME/HLEN/ZCARD probe without consuming or
resetting quota. Backend outage makes readiness unavailable, not liveness.
This read probe does not prove write permissions or provide a DDoS guarantee;
trusted client ingress should still enforce byte/connection limits.

Run `pnpm --filter @workspace/api-server run test:http-limiter:required` with
`redis-server` and `redis-cli` available (or `REDIS_SERVER_BIN`/`REDIS_CLI_BIN`).
This required CI check runs the actual Lua through a local REST bridge against
disposable Redis and two separate Node API processes. It covers concurrent
exhaustion, forged forwarding headers, account isolation, pre-parser upload
rejection, static/SPA budgets, window expiry, bounded-capacity cleanup, idle TTL,
non-consuming probes, redirects, malformed replies, disconnects, timeouts,
outage recovery and stopping Redis itself. Default production/fixture/static
regressions remain included. This is not certification of a client's REST
provider or ingress topology; validate those separately before rollout.

`/health`, `/ready`, `/api/health` and `/api/ready` probes are mounted before
general limits. Readiness continues to coalesce dependency checks with a timeout;
it does not spend AI quota. The older `/api/healthz` API route is not an exemption
from the general budget; configure Kubernetes probes to use `/health` and `/ready`
as the client manifests already do.

## Input and storage boundaries

- Evidence remains UTF-8 XML/JSON/CSV/TSV/TXT, at most **16,000,000 bytes** and
  **20,000 rows**. XML accepts the existing record element names and attributes/
  direct scalar children, decodes standard/numeric XML entities and CDATA, and
  rejects malformed XML, undeclared prefixes, DTD/custom entity declarations.
  XML bounds: depth 64, 200,000 elements, 128 attributes/element, 100-character
  field names and 20,000-character scalar values. No external resolver is used.
- Delimited parsing bounds headers to 20,000 characters, fields to 20,000,
  columns to 128 and rows to 20,000, and rejects unmatched quotes. Plain-text
  lines are limited to 100,000 characters. Compact JSON/XML documents may still
  use the full file-byte budget; they do not inherit the plain-text line limit.
- Before schema validation, parsed JSON requests and evidence JSON are bounded
  to 20,000 items/collection, 128 fields/object, depth 64 and 1,000,000 total
  visited values. Forbidden prototype fields fail at every depth. Ordinary
  unknown evidence columns are discarded by the existing normalized row
  allowlist, not copied into scoring or exports. Canonical attestation output
  remains compatible for legitimate existing evidence.
- Portable PUT accepts a path-bound, expiring HMAC capability and only
  `application/octet-stream`, no query parameters, and a nonempty Buffer up to
  **8 MiB**. The raw parser also caps streamed/decompressed input. Strings,
  arrays, objects, wrong media, repeated query values, empty and excessive
  uploads fail safely. Capability validation, create-only publication and
  sealed bytes remain unchanged.
- Local/Azure/S3 `put` and sealed persistence independently enforce the binary
  contract at runtime, even if invoked outside HTTP/TypeScript. Local storage
  remains create-only, private, same-volume atomic-link publication, with random
  exclusive staging files and cleanup. Cloud stream chunks must be binary and
  bounded. Company DOCX upload and transient evidence multipart handlers also
  check Buffer types/byte limits before decoding/forwarding. DOCX archive
  validation additionally checks its Buffer argument.
- Existing DOCX archive-size, entry-count, expanded-size, UTF-8, relationship,
  active-content, CRC and placeholder restrictions remain. Exact namespace/root
  checks supplement those controls rather than replacing them.

## Local verification and limitations

Commands run against the workspace (synthetic accounts/records were cleaned up):

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass |
| `uv lock --check` | Pass; no Python dependencies remain |
| `pnpm --filter @workspace/api-spec run codegen` | Pass; regenerated Zod 4 schemas and library typecheck |
| `pnpm run typecheck` | Pass across libraries, API, frontend, sandbox and scripts |
| `pnpm --filter @workspace/api-server build` | Pass |
| `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/clean-core build` | Pass; existing source-map/chunk-size/WASM externalization warnings, not errors |
| `LOG_LEVEL=silent pnpm --filter @workspace/api-server test` | 85 pass, 14 opt-in database/Redis tests skipped, 0 failures (see below for explicitly enabled flows) |
| `tsx --test src/client-security.test.ts` in API package | 12 adversarial tests pass, including real middleware exhaustion, static fallback, parser, binary, namespace, temporary-file and contract checks |
| Enabled `accounts.test.ts`, `collaboration-integration.test.ts` with `CC_TEST_ACCOUNTS=true CC_TEST_COLLABORATION=true` | 3 tests pass: passwords/revocation/permissions and durable cross-account review/approval/sealed exports |
| Enabled `knowledge-integration.test.ts`, `reports-integration.test.ts` with local storage and `CC_TEST_KNOWLEDGE=true CC_TEST_REPORTS=true` | 2 lifecycle tests pass, including capability uploads, immutable sealing, permissions, replacement/deletion, Word preview/activation/render and persistence reinitialization |
| `pnpm --filter @workspace/clean-core test:pdf` | 4 tests pass: real multi-page PDF, complex-script typography/ActualText, wrapping, unsupported-character errors |
| `pnpm --filter @workspace/clean-core check:bundle` | Pass; 7 graph tests; initial JS 690,004 raw / 210,749 gzip, within 970,000 / 285,000 budgets; PDF/PPTX/XLSX remain lazy |
| `node --check deploy/{smoke-api,container-smoke,private-temp}.mjs` (each file) | Pass |
| Dependency audit and `pnpm audit --json` | Both report 0 critical/high/moderate/low findings |
| Available SAST | Completed: six HIGH portable-storage path warnings, one MEDIUM SHA-1 warning; analysis below |
| Available privacy/dataflow scanner | Failed to return usable results (schema mismatch); **not** a passing scan |
| Client Mend / CodeQL | Not installed/authenticated locally; not run and not claimed passing |

The opt-in local-storage integration pass initially exposed stale test-harness
assumptions: relative portable URLs were passed directly to Node fetch, and
template tests assumed no company defaults existed. Fixtures now accept both
relative portable and absolute cloud capability URLs and verify personal
selection without overriding company-default precedence or deleting company
data. The corrected flows pass.

No browser journey was changed; schema/runtime checks, API lifecycle integrations
and the running login-page screenshot are used instead of a full browser
automation pass. Container smoke temporary-file behavior is directly tested on
success/failure; the complete disposable Compose/container smoke must be run on
a supported client/CI Docker runner. This workspace's previously established
nested-container exec limitation is not treated as a successful container run.

### Available SAST triage (not scanner suppressions)

- Six HIGH `fs-express` warnings in `knowledge/portable-storage.ts`: `mkdir`,
  `open`, `readFile`, `link`/`unlink` and enumeration take paths rooted in the
  operator-configured persistent directory. Remote object keys first pass
  `storageKey` root/traversal checks, then the **entire key is encoded as one
  base64url filename** (alphabet has no slash, backslash or dot). Staging names
  use generated UUIDs and exclusive creation. Query parameters cannot select
  the directory or a local filesystem path. These are source-to-sink false
  positives for remote path traversal under the current supported threat model;
  filesystem administrators still control their configured volume and must not
  allow untrusted users to write symlinks/files there. No scanner exclusion was
  added. Local create-only/path validation and malformed-input regressions pass.
- One MEDIUM weak-hash warning in `collaboration/github.ts`: SHA-1 computes the
  **Git blob object identity required by the GitHub protocol**, compared with
  the selected API blob ID. It is not password/session/integrity-token
  cryptography. The stored evidence digest uses SHA-256; attestations use
  HMAC-SHA-256. Changing Git's identity algorithm here would break verification,
  so this is a protocol-use false positive, not a reason to disable the rule.

## Client acceptance rerun

1. Merge the changes into the client repository; use a clean supported CI
   workspace. Run `pnpm install --frozen-lockfile`; if Python tooling was
   previously installed, run `uv sync --frozen` to reconcile that environment
   with the empty dependency list (do not leave an old PyMuPDF `.venv` in the
   scanner's source tree).
2. Run codegen/typechecks, API tests, PDF tests and production builds above.
   For isolated integration verification use a disposable PostgreSQL database
   and local private volume, synthetic account secrets supplied securely, and
   existing migrations. Do not point destructive smoke/bootstrap scripts at a
   client production database.
3. Run the client's existing Mend license and dependency-security jobs over the
   full repository/lockfiles/installed packages using the **same policy**.
   Confirm both PyMuPDF reports no longer find an installed dependency and
   Zod resolves as 4.6.7. If the advisory association persists, obtain the exact
   Mend library identity, dependency path, affected range, advisory source and
   scan timestamp; reconcile with the authoritative links above. Do not
   request/paste scan tokens or claim an unsupported fixed CVE version.
4. Run the same CodeQL JavaScript/TypeScript query pack used for the supplied
   15 alerts, including its rate-limiting and regex queries. Check **every row**
   of the inventory against the new revision: six limits, three regexes, two
   property writes, two type-confusion sinks, namespace and temporary file.
   If CodeQL does not recognize the bounded custom store or router inheritance,
   provide the actual middleware ordering and adversarial test evidence for
   security review rather than suppressing or excluding the location.
5. On the supported CI Docker runner run `node deploy/container-smoke.mjs`.
   Verify frontend assets/SPA, read-only root, writable private temporary
   directory, login/password rotation, guidance upload/sealing, Word upload/
   preview/activation, persistence after restart, and migration idempotence.
6. Record Mend job links, CodeQL alert IDs and dispositions, image/revision and
   approved reviewer decisions in the client evidence system. Have the client
   security owner accept the result. Local tests and the available alternative
   scanners are **not** Deere Mend/CodeQL acceptance.
