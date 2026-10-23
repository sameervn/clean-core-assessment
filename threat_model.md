# Threat Model

## Project Overview

Clean Core Assessment is a standalone SAP "Clean Core" assessment product. It is a
pnpm monorepo (Node.js 24, TypeScript 5.9) with:

- **API** (`artifacts/api-server`, Express 5) mounted under `/api`, providing authentication,
  assessment scoring, a shared knowledge base, collaborative review workflows, GitHub source
  ingestion, optional AI explanations, and DOCX/PDF/PPTX/XLSX report generation.
- **Web frontend** (`artifacts/clean-core`, React/Vite) at `/`. Assessment evidence and
  workspaces are primarily browser-local (IndexedDB); the server transiently processes
  evidence through authenticated, permission-checked routes.
- **Canvas** (`artifacts/mockup-sandbox`) is a dev-only design surface at `/__mockup`, not
  served by the production API.

Deployed on Replit (autoscale), visibility `private`, primary URL
`clean-core-assessment.yashtech.ai`. Platform provides TLS.

## Assets

- **Account credentials & sessions** — scrypt password hashes, session cookies (`cc_session`),
  CSRF tokens. Compromise enables impersonation/privilege escalation.
- **Shared assessment data** — classifications, review events, revisions, approvals, uploaded
  source snapshots. Scoped per-assessment membership.
- **Knowledge base documents** — shared guidance stored in private durable object storage
  (GCS/App Storage/S3/Azure/local) with PostgreSQL metadata/text indexes.
- **Application secrets** — `SESSION_SECRET` (evidence HMAC attestations + upload-URL signing),
  `CC_BOOTSTRAP_PASSWORD`, `CC_GITHUB_TOKEN`, Deere AI gateway client credentials,
  object-storage and Redis-REST credentials. Server-only; never sent to client.

## Trust Boundaries

- **Browser → API** — every `/api` request. Cookie session auth (`readIdentity`), CSRF +
  same-origin enforcement (`mutationProtection`), per-route permission checks.
- **API → PostgreSQL** — all queries parameterized; no string concatenation of user input.
- **API → external services** — GitHub (api.github.com), Deere AI gateway, Redis REST,
  object storage. All outbound calls use HTTPS, `redirect: "error"`, timeouts, bounded
  response sizes, and (for GitHub) a repository allowlist.
- **Public/capability routes** — `/api/storage-upload/:token` is unauthenticated but gated by
  a short-lived (5 min) HMAC-signed, path-bound capability token; writes are create-only.
- **User/Admin boundary** — roles Admin/Developer/Reviewer with a fixed permission set;
  `/api/admin` requires Admin; last-active-admin demotion is blocked.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts` (router wiring, body limits,
  middleware order), `src/routes/*` (clean-core, accounts, knowledge, collaboration,
  assessment-github, assessment-exports, report-templates, assessment-ai).
- **Auth core:** `src/auth/{middleware,service,passwords,permissions}.ts`.
- **Access control core:** `src/collaboration/service.ts` (`current`/`access`/`entity`/
  `editable`), enforcing per-assessment membership + role + state.
- **Highest-risk code:** DOCX rendering (`src/reports/engine.mjs` — strict archive inspection
  + tag-only parser, no expressions), GitHub ingestion (`src/collaboration/github.ts`),
  outbound limiters (`src/shared-request-store.ts`, `src/deere-gateway.ts`), storage path
  handling (`src/knowledge/portable-storage.ts` `storageKey`, `src/knowledge/upload-token.ts`).
- **Dev-only / ignore unless proven reachable:** `artifacts/mockup-sandbox`, the uploaded
  source archive referenced in `replit.md` gotchas, `*.test.ts` files.

## Threat Categories

### Spoofing / Improper Authentication
Sessions are random 32-byte tokens stored hashed; cookies are httpOnly, SameSite=Lax, Secure
by default. Mutations require same-origin + a CSRF token compared with `timingSafeEqual`.
Login is throttled per-account via a DB-wide counter with a constant-time dummy hash to avoid
user enumeration. Guarantee: every `/api` sensitive route must resolve a trusted identity
server-side before acting.

### Tampering
Evidence is HMAC-attested with `SESSION_SECRET` and re-verified before scoring; the server
never re-signs arbitrary client-normalized evidence. All DB writes use parameterized queries.
Optimistic-concurrency `expectedVersion` guards protect collaborative edits.

### Information Disclosure
Assessment/knowledge reads are scoped to membership/permissions server-side. Error responses
are generic; logs redact upload URLs and never store raw passwords/secrets. Upload-token route
URL is redacted in logs.

### Denial of Service
Fixed-window request limiters (local or shared Redis-REST, fail-closed) on all `/api` scopes;
body-size caps per route; bounded file/row/archive sizes; outbound timeouts and response-size
caps; DOCX worker concurrency capped.

### Elevation of Privilege
Function-level authorization via `requirePermission`/`requireAdmin`; object-level via
per-assessment membership (`access`) and `editable` role/state checks. Account mutations use
strict Zod schemas (no mass assignment of role/permissions), force empty overrides for Admins,
and preserve at least one active Admin. GitHub/Deere/DOCX inputs are treated as untrusted data,
never executed; the DOCX template parser rejects expressions and unknown tags.
