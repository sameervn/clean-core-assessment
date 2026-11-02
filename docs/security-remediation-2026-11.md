# November dependency and CodeQL remediation

## Scope

Addresses the two supplied Mend dependency findings and all 13 findings in
`CodeQL_issues_1793585103027.docx`. These are implementation and local
verification results, **not** confirmation that the client's Mend or CodeQL
jobs have passed. No alerts, files, rules or packages were suppressed.

## Dependencies

| Reported dependency | Resolution |
| --- | --- |
| Multer 2.4.0 / CVE-2026-113872 | API dependency upgraded to 2.5.0; lockfile updated. |
| Express → body-parser 2.3.0 / CVE-2026-111181 | Express is still current at 5.3.0. A scoped `express>body-parser` override enforces 2.4.0 rather than waiting for a new Express release. |

The dependency audit also identified vulnerable transitive `qs` and
`@azure/msal-node` packages. Refreshing Express's compatible dependencies
resolved `qs` to 6.17.1; upgrading `@azure/identity` to 4.14.1 brought in the
updated MSAL dependency. Actual Node resolution of the updated packages was
checked, not just the dependency manifest.

Both the production and complete workspace dependency audits now report **zero
known vulnerabilities** (verification on 2026-11-02). The complete workspace
audit previously reported 5 high, 9 moderate and 5 low findings.

### Development-tool dependency follow-up

| Dependency / path | Resolution and evidence |
| --- | --- |
| Vite in assessment, slides and mockup artifacts | Shared catalog minimum raised to `^7.3.7`; all three resolve 7.3.7. This stays on Vite 7 and addresses GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw and GHSA-rq7h-c2jc-7f22. |
| Slide editor → prosemirror-view | Direct pin upgraded from 1.41.6 to 1.42.9, addressing GHSA-c8x8-7fp4-3x9w (fixed starting at 1.42.3). Aligned the direct prosemirror-model pin to 1.25.12, the new view's minimum, so all editor packages share one model implementation and compatible types. |
| API codegen → Orval → TypeDoc → markdown-it / minimatch | Upgraded the direct parent Orval from 8.30.0 to 8.46.0. Its current dependency graph removes TypeDoc, markdown-it and minimatch entirely, rather than forcing TypeDoc across incompatible dependency majors. This removes GHSA-r7fv-28h4-cvq7, GHSA-vfgh-jcmw-g37q, GHSA-gfr2-rv44-r23c and GHSA-g3hv-75wg-m249. |
| API codegen → Scalar validators → Ajv → fast-uri | Refreshed only the fast-uri lock resolution from 3.1.8 to 3.1.9, within Ajv 8.20.0's existing `^3.0.1` range, using the registry's published integrity. The parent upgrade retained the old resolution; no new override is needed. Addresses GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr and GHSA-333x-w4r6-6crp. |

No audit exclusions, advisory exceptions, package aliases or new overrides were
introduced for this follow-up. No findings require an unfixable disposition.
Existing runtime-security overrides remain unchanged.

Follow-up verification:

- `pnpm install --frozen-lockfile`: passed, including registry integrity
  verification of the refreshed transitive package.
- `pnpm audit --json` and `pnpm audit --prod --json`: each reports zero critical,
  high, moderate, low and informational findings.
- The dependency scanner also reports zero vulnerabilities.
- Root `pnpm run typecheck`: passed for shared libraries, all four artifacts and
  scripts. The slide chart's pre-existing nullable reduction error was corrected
  by explicitly selecting `reduce<number>`; chart behavior is unchanged.
- API, assessment, slides and mockup production builds: passed, with each web
  artifact's own base path. Existing large-chunk warnings remain advisory.
- Both Orval projects generated successfully into isolated temporary output
  directories using the existing OpenAPI spec and config; checked-in generated
  API files were not rewritten.
- Slide manifest validation: passed.
- All four application workflows restarted successfully. Assessment, slides and
  mockup routes return HTTP 200 through the shared preview proxy.
- Assessment sign-in and slide preview screenshots render without browser errors.
  This is a rendering smoke check, not a claim of a new full browser regression
  or interactive slide-editing test.

## Supplied CodeQL findings

| Alert IDs | Locations | Remediation |
| --- | --- | --- |
| 20, 34 | app.ts; knowledge/fixture.ts | Install `express-rate-limit` directly before identity database access and body parsing. Retain bounded stores, Redis sharing, spoof-resistant client keys and fail-closed 503 responses. |
| 35 | routes/assessment-exports.ts | Direct limiter on company-template and approval-export paths, in addition to existing tighter write/render budgets. |
| 36, 37, 38 | routes/assessment-github.ts | Direct limiter on GitHub and source/evaluation paths before session/database/network work. |
| 22, 24 | routes/knowledge.ts | Direct router limiter before list/detail database queries; retain processing/cleanup budgets. |
| 23 | routes/report-templates.ts | Direct router limiter before template queries; retain report-render budget. |
| 25 | runtime.ts | Direct limiter before static files and SPA fallback; health/readiness remain independent. |
| 39 | knowledge/portable-storage.ts | Explicit runtime object/Buffer checks and binary byte-length bounds; storage paths reject non-strings before string operations. |
| 40 | knowledge/upload-token.ts | Validate decoded capability object, path type and expiry type; validate the raw Buffer and byte length before storage. Reject array/object paths and malformed/expired capabilities even when correctly signed. |
| 41 | client-security.test.ts | Read permissions through open file/directory descriptors, not pathname stat checks followed by pathname operations. Keep exclusive creation and cleanup assertions. |

The limiter configuration is shared, but the middleware passed to Express at
these boundaries is now the direct return value of `rateLimit(...)`. This
matches CodeQL's recognized middleware shape without removing the existing
resource controls. Error handlers are installed immediately after limiters,
before downstream handlers, so limiter-store outages do not admit requests.

## Verification

- API typecheck: passed.
- Clean Core web-app typecheck: passed.
- API production build: passed.
- Targeted security and HTTP limiter suites: **16 passed, zero skipped**, run
  serially with real disposable Redis and `CC_HTTP_REQUIRE_REDIS_TESTS=1`.
- Coverage includes two-process shared limits, limiter outages/recovery,
  request rejection before identity/body work, static limits, upload tampering,
  non-binary values, path tampering, create-only sealing and temporary-file
  privacy/cleanup.
- Production `pnpm audit --prod --json`: zero findings.
- `git diff --check`: passed.

The initial full API suite also ran: 88 passed, 13 skipped and 2 failed. One failure was
the existing AI-limiter integration test expecting HTTP 200 but receiving 401;
the other was the HTTP-limiter test's short expiry under parallel suite load.
The HTTP-limiter test passed in the serial targeted run above. Optional
database-backed tests were not enabled.

The initial root workspace typecheck was blocked by nullable reduction typing
in the slide artifact's ImportedChart component. The merged work includes the
type-only fix described below, and the complete root check now passes.

### Full-project verification restored (2026-11-02)

The AI Redis test fixture now explicitly selects gateway authentication instead
of relying on the local-account default. It supplies an authorized synthetic
account and a storage-only fixture, obtains a real consent token from `/preview`,
and sends the current `{ summary, mode, token }` explanation request. Gateway
signature verification, retrieval/disclosure, consent validation and real Redis
quota enforcement remain active. A valid gateway assertion without a local
account still receives 401 and causes no provider call. Production authorization
and limiter code were not relaxed.

HTTP expiry fixtures now separate admission/capacity assertions from natural
key expiration. Longer windows protect multi-request assertions against parallel
suite scheduling; explicit past-due scores in disposable Redis exercise the real
Lua cleanup. Tests additionally verify that the live subject's count survives
cleanup, capacity remains bounded after replacement, both keys have bounded
TTLs, and a separate one-second store naturally expires before accepting a fresh
count. Expiration uses a bounded poll rather than a fixed sleep.

The slide chart reduction uses a numeric accumulator generic; null data points
and chart rendering behavior are unchanged.

Commands and results:

```sh
CC_AI_REQUIRE_REDIS_TESTS=1 CC_HTTP_REQUIRE_REDIS_TESTS=1 \
  pnpm --filter @workspace/api-server test
# 103 tests: 90 passed, 0 failed, 13 skipped; normal parallel execution,
# disposable real Redis required for both limiter integrations.

pnpm run typecheck
# Passed: shared libraries, API, assessment app, slides, sandbox and scripts.

git diff --check
# Passed.
```

The 13 skips are **optional database-backed integration tests**, not Redis
coverage. None was enabled for this run; these results do not establish that
database integration coverage passed:

| Opt-in flag | Skipped tests | Coverage not run |
| --- | ---: | --- |
| `CC_TEST_ACCOUNTS=true` | 1 | Account API, revocation and permissions |
| `CC_TEST_COLLABORATION=true` | 5 | Approval archive, cross-account collaboration, notification retention/delivery and workspace review |
| `CC_TEST_KNOWLEDGE=true` | 6 | Database cleanup, private-upload/consent lifecycle, indexed retrieval and three portable-storage cleanup variants |
| `CC_TEST_REPORTS=true` | 1 | Private report-template lifecycle, ownership, permissions and restart persistence |

These flags require the corresponding disposable integration database and
storage fixtures; do not enable them against a production database.
The earlier `/tmp/cc-security-tests.log` and `/tmp/cc-security-typecheck.log`
were unavailable. New run output was captured in
`/tmp/cc-verification-api.log` and `/tmp/cc-verification-typecheck.log`
(temporary workspace logs). The slide workflow restarted cleanly and its
preview rendered successfully.

The client's CodeQL CLI/query-pack environment is not installed locally.
Re-run the original Mend and CodeQL jobs against a clean frozen-lockfile build
of this revision, confirm the two dependency versions above and each alert ID,
and retain the new reports before declaring client scan acceptance.
