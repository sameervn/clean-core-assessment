# Optional client-hosted AI explanations

## Local-account deployment

The app now requires local sign-in. `CC_AI_AUTH_MODE=local` is the default:
the backend uses the authenticated account and its `ai.generate` permission for
AI access and per-user limits. Admin role is required for limiter monitoring.
In this mode no gateway key/issuer/audience is needed. Set provider, model,
API key and any Azure endpoint/version as described below, then explicitly
enable AI. All assessment users are provisioned by the app's Admin.

`CC_AI_AUTH_MODE=gateway` retains the additional signed gateway assertion
requirements documented below, on top of local app sign-in and permissions.
Only this mode requires `CC_AI_GATEWAY_*`. It must be explicitly selected;
unverified forwarded user headers never confer permissions.
See `docs/local-accounts.md` for account/bootstrap setup.

The standalone Clean Core Assessment works without AI; local accounts require PostgreSQL.
AI is **off by default**, never participates in the assessment engine, and only
explains a user-previewed assessment summary and bounded uploaded knowledge excerpts after explicit consent. There is no
Replit AI proxy or client-cloud provisioning dependency.

## Server settings

Never use `VITE_` variables for these settings. Inject secrets into the backend
process through your hosting platform's secret manager. Do not commit real values
to a deployment file, image, source control, workspace backup or browser bundle.

| Variable | Required / default | Meaning |
| --- | --- | --- |
| `CC_AI_ENABLED` | Default off; only literal `true` enables | Paid route opt-in, not authorization |
| `CC_AI_PROVIDER` | When enabled | `openai` or `azure` |
| `CC_AI_MODEL` | When enabled | OpenAI chat-completions model ID or Azure deployment name; 1–100 letters, digits, `.`, `_`, `-` |
| `CC_AI_ENDPOINT` | OpenAI defaults to `https://api.openai.com`; required for Azure | HTTPS origin only. OpenAI must be `api.openai.com`; Azure must be `<resource>.openai.azure.com`. No path, port, query, credentials, fragment or arbitrary OpenAI-compatible proxy |
| `CC_AI_API_VERSION` | Azure only | Supported Azure dated API version such as `2024-10-21`; verify availability for your deployment |
| `CC_AI_API_KEY` | When enabled; secret | Provider key from the client secret manager |
| `CC_AI_AUTH_MODE` | Default `local` | Local accounts, or explicit additional `gateway` authorization |
| `CC_AI_GATEWAY_PUBLIC_KEY` | Gateway mode only | RSA public PEM, at least 2048 bits. Literal `\n` escapes or real newlines supported. **Never the private key** |
| `CC_AI_GATEWAY_ISSUER` | Gateway mode only | Exact expected assertion issuer |
| `CC_AI_GATEWAY_AUDIENCE` | Gateway mode only | Exact expected audience string scoped to this app's AI service |
| `CC_AI_LIMITER` | `local` (default) | `local` for a single process, or `redis-rest` for shared limits |
| `CC_AI_LIMITER_URL` | Shared mode only | Administrator-controlled HTTPS Redis REST command endpoint; no URL credentials, query or fragment |
| `CC_AI_LIMITER_TOKEN` | Shared mode only; secret | Dedicated Redis REST access token; **not** a provider credential |
| `CC_AI_LIMITER_NAMESPACE` | Shared mode only | 1–80 letters, digits, `_`, `-`; identical across replicas of this AI service |

The process reads settings at startup. Restart all backend instances after any
configuration change or rotation. Missing/invalid settings fail closed for AI
only; they do not prevent uploads, demo, scoring, notes, backups or exports.
Configuration displays `disabled`, `not configured`, `configured`, or `unavailable`.
Configured means local provider settings and gateway identity passed validation, **not**
that the provider or shared limiter has been probed. Provider/limiter failures show sanitized
messages and a one-minute unavailable status; refreshing configuration rechecks.

### Placeholder-only deployment examples

Supply these as backend environment settings using your deployment tooling.
`${...}` below denotes a secret-manager/template placeholder, not a real value.

```dotenv
CC_AI_ENABLED=false
CC_AI_PROVIDER=openai
CC_AI_MODEL=<chat-completions-model-id>
CC_AI_ENDPOINT=https://api.openai.com
CC_AI_API_KEY=${CLIENT_SECRET_MANAGER_OPENAI_KEY}
CC_AI_GATEWAY_PUBLIC_KEY=${CLIENT_GATEWAY_RSA_PUBLIC_PEM}
CC_AI_GATEWAY_ISSUER=<client-gateway-issuer>
CC_AI_GATEWAY_AUDIENCE=<clean-core-ai-audience>
```

```dotenv
CC_AI_ENABLED=false
CC_AI_PROVIDER=azure
CC_AI_MODEL=<azure-deployment-name>
CC_AI_ENDPOINT=https://<azure-resource>.openai.azure.com
CC_AI_API_VERSION=<supported-yyyy-mm-dd-version>
CC_AI_API_KEY=${CLIENT_SECRET_MANAGER_AZURE_KEY}
CC_AI_GATEWAY_PUBLIC_KEY=${CLIENT_GATEWAY_RSA_PUBLIC_PEM}
CC_AI_GATEWAY_ISSUER=<client-gateway-issuer>
CC_AI_GATEWAY_AUDIENCE=<clean-core-ai-audience>
```

Use a chat-completions model supporting `max_tokens: 800`; reasoning-only models
requiring different request parameters are not supported. OpenAI uses bearer
authorization and `/v1/chat/completions`; Azure uses `api-key` and
`/openai/deployments/<deployment>/chat/completions?api-version=<version>`.
No credentials or provider endpoints are returned to the browser.

## Additional boundary for explicit gateway mode

Enabling a flag or checking an unverified forwarded header is **not** sufficient.
Before setting enablement to true:

1. Put the whole application behind your existing identity-aware gateway, with
   TLS, organizational sign-in, authorization for AI use, secure session cookies,
   CSRF/origin protection, session expiry and revocation. Do not create a second
   identity system in this app.
2. Restrict backend ingress to the gateway using private networking/firewall
   rules. Strip every incoming `X-CC-AI-Assertion` before inserting a fresh one.
   Never return assertions to the browser or accept one supplied by a browser.
3. For each authorized AI status/explanation request, the gateway signs a JWT
   with its **server-held RSA private key** using `RS256`. Send it only over the
   gateway-to-backend TLS channel as `X-CC-AI-Assertion`.
4. Required claims: `iss` and string `aud` matching settings; stable, nonempty
   pseudonymous `sub` (max 200 chars); numeric `iat`, `exp`, optionally `nbf`.
   Lifetime must be no more than **60 seconds**, issued within the last 60
   seconds (up to 5 seconds future clock tolerance), unexpired and not before
   `nbf`. Synchronize clocks. `crit` JWT extensions are not supported.
5. Test that missing, expired, wrong-audience, tampered and arbitrary forwarded
   user headers cannot authorize requests. Only then opt in to enablement.

The backend verifies signature, algorithm, issuer, audience and time claims on
**every paid request**. No shared browser token, forwarded email or `trust proxy`
configuration is used as authentication. A stolen signed assertion can be
replayed within its short lifetime: prevent access to it with TLS, header
stripping, ingress restrictions and gateway log redaction. JWTs and API keys
must never be logged by the gateway, APM, tracing or provider client middleware.
The app's request logger records method/path/status only, not bodies or headers.

## Cost and data controls

- Backend caps: 2 concurrent requests, 20 requests/minute globally, 5/minute per
  verified subject, 2 KB request body, allowlisted summary plus signed consent, 300-character
  recommendation ID, 800 output tokens, 20-second timeout, 64 KB provider
  response, 6,000-character draft. No streaming, retries, tools or autonomous
  actions. Provider redirects are rejected.
- Default limits are **per process**, reset at restart. For horizontal scaling,
  enable the shared limiter below on **every** replica. Also configure gateway-wide
  quotas, provider spending limits and alerts, restricted model/deployment access
  and outbound network policy. These are safeguards,
  not a guaranteed monetary cap; failed or cancelled requests may still cost.
- Preview transmits object/interface kind, level, deterministic solution
  identifier, confidence and target release, plus up to four relevant uploaded
  passages and their title/version/section attribution. No raw files, system IDs,
  expert notes, baseline or override rationale are sent. Excerpts may contain
  client information: inspect the exact preview before consent. All submitted data is
  untrusted and separated from the system prompt. Prompt injection is not
  treated as a security boundary: output cannot trigger tools or scoring.
- Verify provider retention, training, residency, contracts and organization
  policy before enabling. Minimal summaries are still assessment information.
- Drafts are transient. Cancel, discard, selection changes or failed requests
  leave existing notes and accepted explanations unchanged. Cancellation stops
  browser handling; it does not guarantee cancellation of provider billing.
- Acceptance stores text, provider, model, generation time and acceptance time
  separately from editable expert notes. Backups and report exports retain AI
  attribution. Removing an accepted explanation deletes that separate entry.
  Source metadata and fallback policy are retained; replaced/deleted sources
  are marked stale. See `docs/knowledge-base.md` for storage, retrieval,
  insufficient/conflicting guidance, and consent invalidation.
  Old backups without AI fields remain supported. Accepted explanations may
  become outdated after an assessment rerun; review before using them.
- Provider errors are never forwarded verbatim. Authorization failures advise
  checking keys/permissions; 429 advises quota/billing checks; timeouts and
  malformed/truncated responses advise retry/configuration checks.

## Rotation and operation

### Optional shared limiter for horizontally scaled deployments

The standalone default uses in-memory counters and needs no database, Redis
client package, network service or additional credentials. Opting into
`redis-rest` uses standard Redis commands/Lua over an authenticated JSON HTTP
command endpoint (Upstash-compatible protocol). This is client-hosted
infrastructure, not a Replit-specific dependency. A plain Redis TCP endpoint is
not an HTTP endpoint; use a trusted REST adapter or compatible managed service.

```dotenv
CC_AI_LIMITER=redis-rest
CC_AI_LIMITER_URL=https://<client-redis-rest-command-endpoint>
CC_AI_LIMITER_TOKEN=${CLIENT_SECRET_MANAGER_LIMITER_TOKEN}
CC_AI_LIMITER_NAMESPACE=clean-core-production
```

All replicas must use the same Redis database, namespace, stable gateway subject
identifiers and limiter mode. Separate unrelated deployments with distinct
namespaces. A namespace or mode change resets/splits the budget; drain in-flight
requests and coordinate all replicas rather than mixing modes in a rolling
change. Gateway signing-key rotation need not change subject identifiers.

The adapter receives a JSON array such as `["EVAL", script, 2, key1, key2, ...]`
and returns `{"result": 1}` or `{"result": 0}`. It must support Redis `EVAL`,
`TIME`, hash counters, sorted sets and key expiration. Commands inside the
script include `ZREMRANGEBYSCORE`, `HGET`, `DEL`, `HSET`, `ZCARD`, `HINCRBY`,
`PEXPIRE` and `ZADD`; release uses `ZREM`. Use a dedicated ACL restricted to the
`cc-ai:{<namespace>}:*` keys and these operations. Both keys share one Redis
Cluster hash slot. Execute against a single authoritative, strongly consistent
writer, never a read replica or an eventually consistent multi-region cache.

One atomic script checks/reserves **2 concurrent requests, 20 admitted requests
per fixed 60-second window globally, and 5 per verified subject** across all
replicas. Redis server time defines the window. Concurrent leases survive a
window rollover. Rejections consume no request budget; provider failures do
consume it. A fixed window can allow bursts around its boundary, so these
limits are not a sliding-window or monetary guarantee.

Each admitted request gets an unguessable lease ID, released after provider
completion or failure. Leases expire after 60 seconds to recover after a process
crash or uncertain network outcome; this exceeds the provider's 20-second
timeout. No automatic request retries occur. Keep server clocks synchronized
and avoid suspension of live backend processes; leases bound server-side calls,
not how long a provider may continue billing after a timeout or process crash.
Inactive keys expire within 120 seconds. Stored data is only SHA-256 subject
digests (still pseudonymous identifiers, not anonymized data), bounded counters,
timestamps and random lease IDs. No prompt, summary, explanation, raw subject,
gateway assertion or provider credential is sent to or persisted by the limiter.

The HTTP timeout is 2 seconds per operation. Invalid shared settings, outages,
timeouts, redirects, Redis errors and malformed responses fail closed with a
sanitized 503, **never a local fallback**. Budget exhaustion returns 429 with
`Retry-After: 60`. A failed release also returns 503 instead of delivering the
draft; the lease recovers by expiration. After an uncertain acquisition, a
lease may remain until expiry even though no provider call started. Status
shows recent failures for one minute; it is not an active shared-service health
probe. A successful later request clears that instance's recent failure status.

### Limiter readiness and administrator alerts

Poll `GET /api/clean-core/ai/limiter-health` from your monitoring system every
15–30 seconds through the identity gateway. Have the gateway authorize only
operators/monitoring principals for this path and inject a fresh signed assertion
using the same issuer/audience rules as above. Backend verification authenticates
the assertion; operator role authorization remains the gateway's responsibility.
Keep direct backend ingress blocked. No new browser credential is needed.

This endpoint actively checks the limiter, not the paid provider. Shared mode uses
a read-only `EVAL` containing `TIME`, `HGET` and `ZCARD` against the two existing
keys. It never acquires a slot, consumes budget, refreshes TTLs, or cleans leases.
The standard two-second timeout and bounded/sanitized response handling apply.
Concurrent polls are coalesced and results cached for five seconds per replica
(including failures); responses have `Cache-Control: no-store` and `checkedAt`.
The probe checks connectivity, authentication, Lua and key-read compatibility,
**not** write ACLs, available quota, provider health or end-to-end readiness.
Local mode reports local availability only; alert on any mode other than
`redis-rest` when your deployment requires shared budgets.

HTTP 200 means the limiter probe passed; HTTP 503 means unavailable (or AI
disabled/misconfigured). HTTP 401 means the monitoring assertion is invalid or
missing. Alert on two consecutive non-200 responses, connection failures or
timeouts; configure the monitor timeout above two seconds. This detects outages
even when no users generate explanations. Do not use this AI-only check as the
whole application's liveness check: deterministic assessment stays usable.

The JSON `metrics` contains process-lifetime counters: `probeChecks`,
`probeFailures`, `acquisitions`, `admitted`, `rejections` (limiter 429s),
`acquisitionFailures`, and `releaseFailures`. Acquisition latency includes all
outcomes and is reported as `acquisitionLatencyMsTotal` and
`acquisitionLatencyMsMax`; divide the total by acquisitions for the lifetime
mean, or use counter deltas for an interval mean. Alert on any increase in
release/acquisition failures and on sustained rejection rates or high latency
(for example interval mean over 1,000 ms). No identities (even hashes), prompts,
summaries, assertions, tokens, URLs, namespaces or raw errors are recorded in
these metrics. No persistent telemetry store or outbound alert service is added.

Scrape each replica separately and aggregate counter deltas in your monitoring
system, handling resets on restart. A load-balanced scrape samples only one
replica and cannot establish fleet-wide totals. Check `checkedAt` for stale
observations. The client `/status` endpoint remains the lightweight recent-error
view, not readiness.

For a no-cost alert drill in staging, block the Redis REST endpoint or revoke
its dedicated token, poll this endpoint, and confirm the monitor notifies the
administrator on 503; restore access and confirm recovery after the five-second
cache expires. Do not POST `/explain` for this drill. Automated tests simulate
outage/recovery and verify zero acquisitions and zero provider calls.

Use TLS, private networking/egress restrictions, log redaction, persistence,
no-eviction configuration and a failover policy appropriate for enforcing
budgets. Redis flushes, eviction, lost writes on failover, or changing namespaces
can reset counters; if state is lost, gate AI traffic for at least 60 seconds
before resuming. Retain gateway/provider spending controls independently.
Rotate the limiter token through your secret manager across all replicas, then
revoke the old token. Never put it in browser configuration.

Verification: `pnpm --filter @workspace/api-server test` covers default/local
behavior, sanitized failures and route gating. The Redis integration test runs
the actual Lua through a local HTTP adapter with two independent limiter clients,
including simultaneous acquisitions, aggregate user/global caps, rollover,
crash-lease expiry, stale release and outage behavior. It requires `redis-server`
and `redis-cli` on PATH (or `REDIS_SERVER_BIN`/`REDIS_CLI_BIN` paths) and explicitly
skips when unavailable. It uses an ephemeral Unix socket, disables disk
persistence and never connects to a deployment database. Run this test in client
CI and perform a controlled staging test against your chosen REST adapter before
enabling shared mode. The required commands and setup are described below.

### Required client CI and REST-service staging gate

`.github/workflows/ai-limiter-integration.yml` has two non-skipping jobs:

* **Required Redis limiter integration** installs Redis 7+ and OpenSSL and runs
  `pnpm --filter @workspace/api-server run test:limiter:required`. Missing Redis
  binaries are fatal in this mode (`CC_AI_REQUIRE_REDIS_TESTS=1`). In addition to
  actual Lua behavior, real sockets check disconnects, timeouts, recovery,
  301/302/303/307/308 rejection without forwarding credentials, and refusal of an
  untrusted TLS certificate. These tests never reach an AI provider.
  Local runs need Redis 7+ because the fixture uses `redis-cli --json`; override
  `REDIS_SERVER_BIN` and `REDIS_CLI_BIN` if that version is not on PATH.
* **Required Redis REST staging compatibility** runs
  `pnpm --filter @workspace/api-server run test:limiter:staging` against the
  client's chosen Upstash-compatible REST service, not the local adapter.
  Missing settings, unsupported ACL/EVAL behavior, unexpected responses and
  unsuccessful failover assertions exit nonzero, never skip.

Client repository administrators must make **both check names required** in
branch protection/rulesets before enabling shared mode. A workflow file cannot
set repository branch protection. Do not use path filters or `continue-on-error`.
Create the protected `ai-limiter-staging` GitHub environment, restrict trusted
branches and require approval before credentials are released. Do not approve
untrusted PR code; fork PRs without credentials intentionally cannot pass this
gate. Never use `pull_request_target` to run untrusted code with secrets.
Staging runs are serialized because failover affects the whole staging service,
even though individual runs use isolated counter namespaces.

Configure these **test-only** values in that environment (or your client CI's
secret manager for an equivalent staging run):

| Setting | Purpose |
| --- | --- |
| `CC_AI_VERIFY_STAGING_ONLY=yes` | Explicit acknowledgement that the target is a dedicated disposable staging service |
| `CC_AI_VERIFY_URL` | Actual HTTPS Redis REST command endpoint; no URL credentials/query/fragment |
| `CC_AI_VERIFY_TOKEN` (secret) | Dedicated staging ACL token; never the production token or an AI key |
| `CC_AI_VERIFY_REDIRECT_URL` | Client-controlled HTTPS endpoint returning a real POST redirect; receives only a dummy token, never the service token |
| `CC_AI_VERIFY_FAILOVER_HOOK` | Path to a client-owned executable on the runner that performs the service's staging failover and waits for recovery |

Use a dedicated staging database, not just another namespace on production:
the failover drill affects the service. Grant the test token only
`~cc-ai:{ci-*}:*` and the limiter commands listed above (including EVAL and TIME);
do not grant administrative or wildcard command access. The verifier generates
fresh `ci-<UUID>` namespaces automatically and synthetic subjects, never reads
application limiter settings and never invokes provider routes. Two read-only
EVAL/HGET probes address random **non-production** keys outside that prefix and
must receive an explicit permission error. A general outage or authentication
failure is not accepted as proof of ACL enforcement. Services unable to restrict
these keys or execute this Lua are incompatible with this deployment contract.
Inert test counters expire within 120 seconds; no FLUSHDB, SCAN, cleanup token or
production counter access is used.

The failover hook is necessarily service-specific: use the chosen service's
documented staging promotion/restart API or staging infrastructure automation.
It must initiate an actual writer failover, wait for the canonical REST URL to
serve the new writer, and exit nonzero on failure. Do not supply a no-op hook:
the verifier can detect lost state but cannot prove the control plane promoted a
writer. Capture promotion evidence in your infrastructure audit trail, not REST
tokens in CI logs. Provision hook credentials separately with access only to
staging. The hook is run directly (no shell interpolation), gets no counters or
tokens as arguments, has a 30-second timeout, and its output is suppressed.
Keep the entire failover stage below 45 seconds to avoid mistaking legitimate
lease/window expiry for data loss; slower services need a separately designed
maintenance drill rather than weakening this assertion.

Before failover the verifier reserves both slots; afterward a second client must
still receive 429. It then releases/replaces leases and verifies that exactly the
remaining global budget can be used. This catches lost acknowledged reservations,
counter resets, broken release permissions and routing to a different database.
It also verifies the five-request subject cap, rejects an invalid token, checks
the numeric `{ "result": 0 | 1 }` contract via the production limiter, and tests
redirect rejection. Valid HTTPS uses Node's normal trust validation; custom
staging CAs may use `NODE_EXTRA_CA_CERTS`, never `NODE_TLS_REJECT_UNAUTHORIZED=0`.
The local required suite covers unavailable/uncertain responses with no retries
or local fallback; the external gate verifies actual failover continuity.

Only generic PASS stage markers and a sanitized failure message are printed.
On failure, inspect service-side staging audit logs rather than enabling HTTP
body/token logging. A green local test is **not** evidence of managed-service
compatibility. Re-run the external gate whenever the service, ACL, adapter, TLS
configuration or failover policy changes, and retain its successful CI run and
the staging promotion audit record as release evidence.

Disable AI during maintenance if needed. Rotate provider keys in your secret
manager, restart all backend instances, verify an authorized request, then revoke
the old key. For gateway keys, coordinate gateway signer and backend public-key
rotation; the service pins one public key, so plan a brief fail-closed transition.
Keep gateway private keys and the assessment `SESSION_SECRET` independent.
Rotating an AI key does not invalidate evidence attestations.

Use Configuration → Assessment AI for safe status and setup guidance. In object
or interface details choose Preview AI request → consent → review draft → accept
or discard. Acceptance does not save or overwrite any unfinished expert-note
edit, nor change deterministic classifications, scores or recommendations.

Automated tests use synthetic keys and mocked providers. No real provider smoke
test was run for this implementation: client credentials and a deployed,
authorized client gateway were not available.
