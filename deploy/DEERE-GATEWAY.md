# Deere backend gateway handoff

## Boundaries and confirmed source

Local sign-in, Admin/Developer/Reviewer permissions, AI consent, knowledge-first
retrieval and citations, deterministic scoring and shared/local rate limits stay
in the app. The browser talks only to this backend. Keep `CC_AI_AUTH_MODE=local`.
Its other value, `gateway`, is an unrelated **incoming user assertion** mode;
it is not Deere service authentication and is rejected with the Deere provider.

The supplied “Make your first Gateway call” PDF (updated September 2, 2026)
documents Direct OAuth with client credentials in a form body, **no scope**,
and `/openai/chat/completions`. Managed flow is deprecated and not implemented.
The transcript discusses a dev client and Claude Opus 4.6, but does not prove
the exact provisioned model identifier or OpenAI-compatible Claude routing.

Client handoff values supplied for confirmation:
- Registration: `clean-core-assessment-tool`
- Client ID: `0oa2v9rn39jCKiiUn0h8`
- Client secret: **not supplied**; deliver only through approved secret storage.
- Base: `https://ai-gateway.deere.com`
- Dev issuer: `https://sso-dev.johndeere.com/oauth2/ausx8znnnrQpD7x0f0h7`
- Production issuer: `https://sso.johndeere.com/oauth2/aushh24tmyH9xSbQ21t7`

Confirm the client belongs to dev before selecting that issuer. Do not use a
dev client with the production issuer. Ask the gateway owner to confirm the
registration is provisioned, the client is associated, model access is granted,
and the **exact model ID, route and protocol**. Do not invent registration YAML.
Only `openai-chat` with `/openai/chat/completions` is currently implemented.
Other routes/protocols fail closed and require an adapter after documentation
and approval. Claude Opus 4.6 is **not yet verified**.

## One configuration source

Populate a protected copy of `deploy/.env.example`, the authoritative template.
Set `CC_AI_ENABLED=true`, `CC_AI_PROVIDER=deere-gateway`, `CC_AI_AUTH_MODE=local`,
the confirmed `CC_AI_MODEL`, and all seven `AI_GATEWAY_*` entries. Direct API
keys are not used; no failure ever switches to OpenAI, Azure or another provider.

`CC_RUNTIME_ENV_FILE` opts into an absolute file path at process startup.
Node's env-file parser handles quotes and escaped multiline values, without
shell execution or variable interpolation. Existing environment values win,
even if empty. A missing/unreadable configured file fails startup with a safe
error. Unset means no file read, preserving Replit and ordinary env injection.
Both the compiled app and migration entrypoints load the file before database,
logger, storage or provider initialization. No file contents are logged.
`CC_ENV_FILE` remains the separate Compose CLI input path, not this loader.

## Kubernetes and client CI

Create two existing Secrets using your approved secret manager/Secret-sync
process: one containing the runtime `.env`, another containing a minimal
migration `.env` with the migration-role DATABASE_URL and TLS settings.
Do not grant the running app migration privileges. Secrets must exist before
the pre-install migration hook. No credentials belong in Git, chart values,
ConfigMaps, images, command output, build arguments or Helm command arguments.
The Docker ignore rules exclude populated env files.

In a reviewed non-secret client values overlay:

```yaml
runtimeEnvFile:
  enabled: true
  existingSecret: clean-core-runtime-file
  key: .env
migration:
  enabled: true
  serviceAccountName: clean-core-migration
  runtimeEnvFile:
    enabled: true
    existingSecret: clean-core-migration-file
    key: .env
```

File mode replaces app envFrom and DATABASE_URL env injection. Secret volumes
are read-only, mode 0440, accessible using the chart's fsGroup 1000; do not
remove that group access. Both mount at `/etc/clean-core/.env`. The chart still
injects replica count and optional CA path; migrations also inject production,
static directory and pool size 3. These values take precedence over the file.
Keep non-secret chart `config` storage/AI/limiter settings consistent with the
file for chart scaling checks; runtime checks independently enforce actual
replica safety. Port must remain 8080 for this chart. No secret file is rendered
by Helm, and Helm cannot validate its content.

Use private RDS PostgreSQL with the approved RDS CA ConfigMap and verified TLS.
Do not disable TLS verification. RDS stores application data; **S3 is separate**
private, versioned file storage. Prefer AWS workload identity over static keys.
Allow DNS, private RDS, S3/identity and optional Redis REST egress plus HTTPS
to the selected Okta issuer and ai-gateway.deere.com. Kubernetes NetworkPolicy
FQDN filtering requires a capable CNI or an approved egress proxy; generic
NetworkPolicy rules alone cannot safely express these hostnames.

Rotate credentials by updating the managed Secret, restarting the Deployment
and rerunning migration jobs when their credentials change. Env values and
tokens are memory-only snapshots; projected file updates alone do not reload
configuration. The token cache honors validated expires_in with a safety
margin, coalesces concurrent refreshes, and allows one retry on 401/403.
Token calls have 10-second timeouts; each model attempt has 20 seconds.
429s are returned without immediate retries. No upstream bodies are exposed.

## Live smoke check (explicit, quota-consuming)

1. Confirm routing and issuer with the gateway owner and securely provision
   credentials. Use an approved non-production environment and synthetic data.
2. Run the migration, start the app, verify `/health` and `/ready`, and sign in
   with a local account. Readiness does **not** obtain a token or invoke a model.
   It is not evidence of provider connectivity.
3. With an account granted AI permission, open a synthetic assessment, use an
   approved test knowledge source, review the exact AI consent preview, and
   explicitly generate one explanation. This consumes gateway quota.
4. Verify success identifies `deere-gateway` and the approved model; check
   citation references and unsupported-gap behavior. Confirm scores did not
   change. Save/reload the workspace and confirm the explanation is preserved.
5. Confirm a user without AI permission is denied and can still use permitted
   non-AI features. With a separate disposable misconfigured deployment, confirm
   rejected service credentials fail safely without direct-provider fallback.
6. Record date, environment, approved route/model and sanitized pass/fail only.
   Never record access tokens, client secrets, authorization headers or payloads.

Automated HTTP mocks prove request shape, caching, retries and safe failures,
not actual registration or model compatibility. Build/type checks and Helm
renders prove packaging/configuration syntax, not cluster operation. Container
runtime checks (if available) are separate from image builds. A real successful
gateway call with confirmed client settings is still required before claiming
live validation. No live client call or production deployment is part of this
implementation.

## Implementation verification record

Verified on October 14, 2026:
- API automated tests: 65 passed, 9 opt-in database/cloud integration tests
  skipped. Deere requests were mocked; no real tokens were requested.
- API and frontend type checks, API code generation and production frontend
  build passed. Existing frontend chunk-size warnings remain.
- All existing Helm profiles and new Secret-only/file-mount rejection/render
  checks passed using `bash deploy/check-helm.sh`.
- `node deploy/check-env-startup.mjs` passed for both compiled entrypoints,
  proving file loading precedes database initialization and missing files fail.
- Docker image build passed. `node deploy/check-env-startup.mjs IMAGE_TAG`
  also passed inside the built non-root, read-only, network-disabled container
  with a read-only mounted synthetic env file. This tests startup ordering,
  **not** a live database, running Kubernetes cluster or complete app health.
- Workspace backup/provenance tests passed including Deere attribution and
  model IDs with routing punctuation. Local sign-in rendered normally;
  account login and role/consent middleware were not changed.
- Live Deere/Okta/Claude, private RDS/S3, and Kubernetes Secret rotation:
  **not verified**; client credentials, routing confirmation and cluster access
  are required. No production publication was performed.
