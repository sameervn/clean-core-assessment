# Environment reference

`deploy/.env.example` is the authoritative placeholder-only runtime template.
This document explains its variables; do not maintain a second populated copy
in the repository. Deere handoff and live validation: [DEERE-GATEWAY.md](DEERE-GATEWAY.md).

No examples are credentials. `—` means unset/no default. Required refers to
the selected feature. Keep secret values in Kubernetes Secrets or a client
secret manager, never Helm values, ConfigMaps, build arguments or logs.

## Application runtime

| Variable | Purpose | Required | Secret | Default | Placeholder example |
|---|---|---|---|---|---|
| DATABASE_URL | Standard PostgreSQL connection (RDS supported) | yes | yes | — | `postgresql://app:REPLACE@db.example.com:5432/clean_core` |
| SESSION_SECRET | Throttling/session-adjacent HMAC; portable upload capabilities | yes for portable uploads; use everywhere | yes | — | random 32+ characters |
| CC_BOOTSTRAP_PASSWORD | First admin password on an empty account table; remove after setup | initial setup | yes | — | unique random 14–128 characters |
| PORT | API bind port on 0.0.0.0 | no | no | 8080 | 8080 |
| NODE_ENV | Production logging and secure-origin policy | production | no | environment | production |
| LOG_LEVEL | stdout/stderr Pino level | no | no | info | warn |
| CC_RUNTIME_ENV_FILE | Absolute path to optional mounted env file; loaded before app and migration imports; injected environment wins | no | file contains secrets | unset (no file read) | /etc/clean-core/.env |
| CC_STATIC_DIR | Opt-in compiled frontend directory; absent preserves Replit split services | container | no | — | /app/public |
| CC_SCHEMA_BOOTSTRAP | Allow legacy runtime knowledge/template DDL; false with migration identity | no | no | true | false |
| CC_REPLICA_COUNT | Scaling validation; Helm sets max replicas for HPA | no | no | 1 | 2 |
| CC_COOKIE_INSECURE | HTTP-only local test cookie/origin opt-out; never HTTPS production | no | no | false | true (localhost only) |
| CC_DB_POOL_MAX | Maximum DB connections per process, 1–100 | no | no | 10 | 5 |
| CC_DB_CA_FILE | Verified PostgreSQL CA PEM; no URL ssl overrides when set | RDS profile | no | — | /etc/db-ca/ca.pem |
| CC_DB_ALLOW_PLAINTEXT | Local Compose exception; not for a client network | no | no | false | true (Compose only) |
| CC_KNOWLEDGE_STORAGE | replit, gcs, azure, s3 or local; never error fallback | portable deployment | no | replit | s3 |
| PRIVATE_OBJECT_DIR | Namespace root for both guidance and personal templates | storage enabled | no | — | /documents/private (cloud SDK key prefix); /bucket/prefix (GCS) |
| CC_STORAGE_LOCAL_DIR | Absolute persistent volume mount | local | no | — | /data |
| CC_S3_BUCKET | Private version-enabled S3 bucket | s3 | no | — | client-documents |
| CC_S3_REGION | AWS region independently from RDS | s3 | no | — | eu-west-1 |
| CC_S3_ENDPOINT | Optional HTTPS S3-compatible endpoint; must support versioning and create-only PUT | no | no | SDK regional endpoint | https://s3.eu-west-1.amazonaws.com |
| CC_AZURE_STORAGE_URL | Blob service HTTPS URL | azure | no | — | https://client.blob.core.windows.net |
| CC_AZURE_STORAGE_CONTAINER | Private Blob container | azure | no | — | documents |
| PUBLIC_OBJECT_SEARCH_PATHS | Existing generic object helper public search paths (not knowledge/templates) | no | no | — | /bucket/public |
| CC_AI_ENABLED | Enable optional AI | no | no | false | true |
| CC_AI_PROVIDER | openai, azure or deere-gateway | AI | no | — | deere-gateway |
| CC_AI_API_KEY | Direct provider credential; unused in Deere mode | OpenAI/Azure AI | yes | — | REPLACE |
| CC_AI_MODEL | Approved gateway model ID, OpenAI model ID or Azure **deployment name** | AI | no | — | approved-model |
| AI_GATEWAY_REGISTRATION_ID | Deere registration header | Deere | no | — | REPLACE-REGISTRATION |
| AI_GATEWAY_CLIENT_ID | Outbound Okta service client | Deere | no | — | REPLACE-CLIENT-ID |
| AI_GATEWAY_CLIENT_SECRET | Outbound service credential; never frontend auth | Deere | yes | — | REPLACE |
| AI_GATEWAY_BASE_URL | Approved Deere HTTPS origin | Deere | no | — | https://ai-gateway.deere.com |
| AI_GATEWAY_ISSUER | Exact approved dev or production issuer (see handoff) | Deere | no | — | confirmed issuer |
| AI_GATEWAY_PROTOCOL | Approved request/response protocol; only openai-chat implemented | Deere | no | — | openai-chat |
| AI_GATEWAY_ROUTE | Approved route; only documented /openai/chat/completions implemented | Deere | no | — | /openai/chat/completions |
| CC_AI_ENDPOINT | Approved provider HTTPS origin; OpenAI fixed api.openai.com, Azure resource.openai.azure.com | Azure AI | no | https://api.openai.com for OpenAI | https://client.openai.azure.com |
| CC_AI_API_VERSION | Azure API version, date format | Azure AI | no | — | 2024-10-21 |
| CC_AI_AUTH_MODE | local account permission or existing signed gateway assertion | AI | no | local | local |
| CC_AI_GATEWAY_PUBLIC_KEY | RSA >=2048 public PEM, literal or escaped newlines | gateway AI mode | no | — | public PEM |
| CC_AI_GATEWAY_ISSUER | Exact assertion issuer | gateway AI mode | no | — | https://gateway.example.com |
| CC_AI_GATEWAY_AUDIENCE | Exact assertion audience | gateway AI mode | no | — | clean-core |
| CC_AI_LIMITER | local or redis-rest | multi-replica AI | no | local | redis-rest |
| CC_AI_LIMITER_URL | HTTPS Redis REST command endpoint, not redis:// | redis-rest | no | — | https://limiter.example.com |
| CC_AI_LIMITER_TOKEN | Redis REST bearer token | redis-rest | yes | — | REPLACE |
| CC_AI_LIMITER_NAMESPACE | Shared budget identifier across replicas | redis-rest | no | — | clean-core-prod |

## SDK-managed identity

These are read by the cloud SDK, not manually interpreted by application code.
Prefer workload identity. SDK default credential chains may support other
standard provider variables; the listed options are the supported handoff paths.

| Variable | Purpose | Required | Secret | Default | Example |
|---|---|---|---|---|---|
| AWS_ROLE_ARN | IRSA/web identity target role | chosen identity | no | SDK chain | arn:aws:iam::123456789012:role/clean-core |
| AWS_WEB_IDENTITY_TOKEN_FILE | Projected token file | IRSA | file contains secret | — | /var/run/secrets/eks.amazonaws.com/serviceaccount/token |
| AWS_CONTAINER_CREDENTIALS_FULL_URI | EKS Pod Identity credential service, injected by platform | Pod Identity | no | — | platform-injected |
| AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE | Pod Identity token path | Pod Identity | file contains secret | — | platform-injected |
| AWS_ACCESS_KEY_ID | Alternative credential ID | static alternative | yes | — | REPLACE |
| AWS_SECRET_ACCESS_KEY | Alternative credential secret | static alternative | yes | — | REPLACE |
| AWS_SESSION_TOKEN | Short-lived credential token | temporary credentials | yes | — | REPLACE |
| AZURE_CLIENT_ID | User-assigned identity | Azure workload identity | no | SDK chain | client UUID |
| AZURE_TENANT_ID | Identity tenant | Azure workload identity | no | SDK chain | tenant UUID |
| AZURE_FEDERATED_TOKEN_FILE | Projected OIDC token | Azure workload identity | file contains secret | — | /var/run/secrets/azure/tokens/azure-identity-token |
| AZURE_CLIENT_SECRET | Alternative service principal credential | alternative only | yes | — | REPLACE |
| GOOGLE_APPLICATION_CREDENTIALS | Native GCS ADC file (prefer federation configuration) | chosen GCS identity | file may contain secret | SDK ADC chain | /etc/gcp/adc.json |

## Build, platform and tests (not client runtime configuration)

| Variable | Purpose | Required | Secret | Default | Example |
|---|---|---|---|---|---|
| BASE_PATH | Vite asset base path | frontend build/dev | no | — | / |
| PORT | Vite dev/config evaluation port | frontend build/dev | no | — | 5173 |
| NODE_ENV | Disable development plugins in production builds | build | no | environment | production |
| import.meta.env.BASE_URL | Vite-generated browser asset prefix, not a secret/env to inject at runtime | generated | no | build base | / |
| import.meta.env.DEV | Vite-generated compile-time development flag | generated | no | Vite mode | false |
| REPL_ID | Replit plugin activation | Replit-managed | no | — | platform |
| REPLIT_DEV_DOMAIN | Development browser-test target only | Replit-managed | no | — | platform.replit.dev |
| DEFAULT_OBJECT_STORAGE_BUCKET_ID | Replit storage configuration (no direct app read) | Replit-managed | no | platform | platform |
| PATH | Child parser/worker binary lookup | OS | no | OS | /usr/local/bin:/usr/bin:/bin |
| CC_TEST_ACCOUNTS | Opt into synthetic DB account integration tests | tests | no | false | true |
| CC_TEST_KNOWLEDGE | Opt into guidance DB/storage integration tests | tests | no | false | true |
| CC_TEST_REPORTS | Opt into personal DOCX DB/storage tests | tests | no | false | true |
| CC_AI_REQUIRE_REDIS_TESTS | Fail rather than skip local Redis fixture tests | tests | no | 0 | 1 |
| CLEAN_CORE_BASE_URL | Browser test app URL | tests | no | Replit development URL | http://localhost:80 |
| PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH | Test browser binary | tests | no | discovery | /repl/tools/bin/chromium |
| SYNTHETIC_PASSWORD | Test-only account password | tests | yes | fixture-specific | unique disposable value |
| REDIS_CLI_BIN | Redis fixture CLI | tests | no | discovery | redis-cli |
| REDIS_SERVER_BIN | Redis fixture executable | tests | no | discovery | redis-server |
| NODE_TLS_REJECT_UNAUTHORIZED | Existing tests reject unsafe TLS overrides; **never set 0** | never configure | no | Node secure default | 1 |
| POSTGRES_PASSWORD | Compose-only disposable DB password | Compose | yes | — | random URL-safe string |
| CC_ENV_FILE | Compose input env-file location, not app configuration | no | no | .env | /protected/client.env |
| CC_SMOKE_SKIP_BUILD | Test-only reuse of already built clean-core:local image | no | no | false | true |

CI variables are documented in ci/README.md; Terraform inputs are declared in
terraform/variables.tf. They are not application environment variables.
