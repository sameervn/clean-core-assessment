# Saved-workspace browser regressions

## Account switching with retained conflict drafts

Run `pnpm --filter @workspace/clean-core exec playwright test recovery-account-switch.spec.ts`
with both API and web workflows running and the development account database available.
Two focused cases use real synthetic Developer accounts and three shared-cookie tabs:
explicit logout or database-expired sessions, a paused UI autosave, B login,
notes permission revocation/refresh, and A login again. Downloaded recovery
payloads and complete canonical/draft records are compared before and after reloads.
Database helpers modify only fixture-prefixed accounts; teardown deletes them.
This intentionally does not repeat general browser-restart draft recovery coverage.

Run downloaded AI report content checks with
`pnpm --filter @workspace/clean-core test:browser ai-report-downloads.spec.ts`.
Both web and API workflows must be running. This test requires `unzip` and
Poppler's `pdftotext` on PATH (available in the Replit runtime). It downloads all
six report formats through the UI and parses the resulting bytes, covering object
and interface notes that are current, changed, legacy, or removed. Assertions
include exact attribution, review reasons, CSV quoted multiline cells, and a
45-paragraph accepted explanation spanning multiple slides and PDF pages.
The fixture is synthetic browser-local data derived from the demo; no AI calls
or production data are used.

Run the focused AI Review regression with
`pnpm --filter @workspace/clean-core test:browser ai-review.spec.ts`.
It seeds a small synthetic workspace in isolated IndexedDB with current, changed,
and legacy accepted explanations of both kinds. It checks queue counts, status
and name/endpoint/ID filters, both detail panels, and explicit replacement of an
object and an interface explanation. Exact saved-map comparisons and a reload
protect sibling explanations, expert notes, and assessment results. AI status
and generation are intercepted with deterministic responses; this test needs
only the web workflow, no provider credentials or live AI calls.

Run only AI availability coverage with
`pnpm --filter @workspace/clean-core test:browser ai-review.spec.ts -g "AI status"`.
Eight cases cover unavailable and disabled status payloads, HTTP 503 responses,
and network failures for both object and interface details. Each case verifies
disabled preview/absent consent, zero generation requests, visible accepted text,
and two expert-note saves with reloads. Exact saved maps protect sibling notes,
accepted explanations, and assessment results. All AI endpoints are intercepted;
only the web workflow is needed.

Separate removal cases in the same spec exercise both object-first and
interface-first deletion, without generating or accepting replacement drafts.
After every removal they verify exact remaining saved maps, queue counts and
rows, expert notes, and reload persistence. The final removal checks the empty
review queue while current accepted explanations remain saved outside the queue.
Run only these cases with
`pnpm --filter @workspace/clean-core test:browser ai-review.spec.ts -g "removing accepted"`.

Run the focused real multi-tab connection lifecycle regression with
`pnpm --filter @workspace/clean-core test:browser storage-lifecycle.spec.ts`.
It uses an isolated context and a test-only requested schema version to create a
native blocked upgrade (not a synthetic blocked event), verifies late-success
connection cleanup and UI Retry, then checks versionchange closure and reopening.

## Focused dashboard charts

With only the Clean Core web workflow running:

```sh
pnpm --filter @workspace/clean-core test:browser dashboard-charts.spec.ts
```

These tests intercept the demo endpoint with a fixed ten-object assessment; no
live API, random demo data, storage seeding, or AI provider is required. They
exercise the real dashboard aggregation and lazy-loaded Recharts component:
classification slice colors and relative painted areas, matching legend colors,
dimension labels and proportional bars, real mouse-hover tooltip labels/counts,
narrow/wide viewport resizing, and navigation away/back after smaller and empty
assessments replace the data. Assertions wait for rendered elements rather than
using fixed animation sleeps. They deliberately do not test startup budgets or
workspace persistence.

## Full suite

With the Clean Core web and API workflows running:

```sh
pnpm --filter @workspace/clean-core test:browser
```

The default target is the Replit development proxy (or localhost port 80 outside
Replit). Set `CLEAN_CORE_BASE_URL` to another development server including its base
path and trailing slash. Do not target production. On non-Replit machines install
Chromium with `pnpm --filter @workspace/clean-core exec playwright install chromium`,
or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Every test gets a new browser context with isolated IndexedDB. Round-trip tests load the real
4,000-object demo through the UI and use the live API, not fixed attestation
fixtures (these depend on the server's current signing key). They wait for committed
IndexedDB data and the save indicator rather than sleeping for debounce timers.
The quota case injects a browser write failure and restores the native method
before testing retry. Hydration tests seed small synthetic records, then inject
unavailable IndexedDB, blocked opens, and asynchronous open errors before app
startup. They check failed Retry and successful recovery, using a second page
in the same isolated context to inspect the real record during the fault.
Corrupt-record hydration is checked across repeated reloads. A transaction spy
and an advanced browser clock verify that no writes occur beyond the autosave
debounce, while full-record equality protects recoverable fields and timestamps.
Recovery tests also compare downloaded raw JSON with the original record, cancel
and reload without replacement, confirm an empty replacement survives reload,
and inject a failed replacement write before retrying.
Run just these cases with
`pnpm --filter @workspace/clean-core test:browser -g "storage hydration|corrupt stored workspace|unreadable"`.
Downloads are read from Playwright's temporary download
directory. Failure traces and screenshots go under ignored `generated-artifacts/`.
The full suite can take more than five minutes on a shared development container;
use a background shell or a CI runner without a five-minute command limit. A
single case can be selected with
`pnpm --filter @workspace/clean-core exec playwright test -g "quota failure"`.

Coverage: complete inventory/baseline reload persistence; actual backup download,
restore with server recomputation, clear and reload; cancellation of all three
replacement dialogs; malformed/schema-invalid and tampered-attestation backups;
quota failure, rescue backup and retry; unavailable/blocked/failed storage opens
and Retry; corrupt saved-data hydration without destructive autosave; all seven
Export Center download actions.
