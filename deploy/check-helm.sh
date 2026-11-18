#!/usr/bin/env bash
set -euo pipefail
chart=deploy/helm/clean-core
for profile in dev prod aws; do
  helm lint "$chart" -f "$chart/values-$profile.yaml"
  helm template check "$chart" -f "$chart/values-$profile.yaml" >/dev/null
done
helm template check "$chart" -f "$chart/values-aws.yaml" \
  --set migration.enabled=true --set autoscaling.enabled=true \
  --set config.CC_HTTP_LIMITER=redis-rest \
  --set ingress.enabled=true --set networkPolicy.enabled=true >/dev/null
helm template check "$chart" --set secret.create=true --set existingSecret='' \
  --set-string secret.data.DATABASE_URL=placeholder >/dev/null
if helm template check "$chart" -f "$chart/values-dev.yaml" --set replicaCount=2 >/dev/null 2>&1; then
  echo "ERROR: unsafe local scaling accepted"; exit 1
fi
if helm template check "$chart" --set replicaCount=2 --set-string config.CC_AI_ENABLED=true >/dev/null 2>&1; then
  echo "ERROR: unshared AI quota accepted"; exit 1
fi
render=$(helm template check "$chart" -f "$chart/values-aws.yaml" --set migration.enabled=true)
grep -q 'secretKeyRef:' <<<"$render"
grep -q 'name: clean-core-migration' <<<"$render"
grep -q 'name: rds-ca-bundle' <<<"$render"
echo "Helm profiles and rejection checks passed"
fileRender=$(helm template check "$chart" -f "$chart/values-aws.yaml" \
  --set migration.enabled=true --set runtimeEnvFile.enabled=true \
  --set migration.runtimeEnvFile.enabled=true)
test "$(grep -c 'name: CC_RUNTIME_ENV_FILE' <<<"$fileRender")" = 2
test "$(grep -c 'defaultMode: 0440' <<<"$fileRender")" = 2
test "$(grep -c 'mountPath: /etc/clean-core, readOnly: true' <<<"$fileRender")" = 2
grep -q 'secretName: clean-core-runtime-file' <<<"$fileRender"
grep -q 'secretName: clean-core-migration-file' <<<"$fileRender"
if grep -q 'name: DATABASE_URL' <<<"$fileRender"; then
  echo "ERROR: mounted file database configuration was overridden"; exit 1
fi
if helm template check "$chart" --set-string config.AI_GATEWAY_CLIENT_SECRET=placeholder >/dev/null 2>&1; then
  echo "ERROR: gateway credential accepted in ConfigMap"; exit 1
fi
echo "App and migration Secret file rendering passed"
for pipeline in deploy/ci/github-actions.yml deploy/ci/azure-pipelines.yml; do
  grep -q -- '--set migration.enabled=true' "$pipeline"
done
echo "Both CI releases explicitly enable pre-install/pre-upgrade migrations"
provisionRender=$(helm template check "$chart" -f "$chart/values-aws.yaml" \
  --set migration.enabled=true --set provisioning.enabled=true \
  --set provisioning.serviceAccountName=clean-core-provisioner)
grep -q 'kind: CronJob' <<<"$provisionRender"
grep -q 'command: \[node, dist/provision.mjs\]' <<<"$provisionRender"
grep -q 'concurrencyPolicy: Forbid' <<<"$provisionRender"
test "$(grep -c 'name: clean-core-provisioner' <<<"$provisionRender")" = 1
test "$(grep -c 'name: CC_PROJECT_OWNER_ROLE' <<<"$provisionRender")" = 2
test "$(grep -c 'name: CC_DB_CA_FILE' <<<"$provisionRender")" = 3
for unsafe in \
  'provisioning.existingSecret=clean-core-runtime' \
  'provisioning.existingSecret=clean-core-migration' \
  'provisioning.projectRuntimeRole=clean_core_project_owner' \
  'provisioning.projectOwnerRole=other_owner' \
  'config.CC_SCHEMA_BOOTSTRAP=true'; do
  if helm template check "$chart" -f "$chart/values-aws.yaml" \
    --set migration.enabled=true --set provisioning.enabled=true \
    --set provisioning.serviceAccountName=clean-core-provisioner \
    --set-string "$unsafe" >/dev/null 2>&1; then
    echo "ERROR: unsafe provisioning settings accepted: $unsafe"; exit 1
  fi
done
echo "Separate provisioner job, Secret isolation, role consistency and CA rendering passed"
