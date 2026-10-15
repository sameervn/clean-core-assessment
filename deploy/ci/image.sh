#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE:?Set full registry/repository:immutable-tag}"
mkdir -p generated-artifacts
docker build --platform linux/amd64 -t "$IMAGE" .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.69.3 image --exit-code 1 --severity CRITICAL "$IMAGE"
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  anchore/syft:v1.42.2 "$IMAGE" -o spdx-json >generated-artifacts/sbom.spdx.json
if [ "${PUSH_IMAGE:-false}" = true ]; then
  : "${REGISTRY:?Set registry hostname}" "${REGISTRY_USER:?Set registry user}" "${REGISTRY_PASSWORD:?Provide protected registry credential}"
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin
  trap 'docker logout "$REGISTRY" >/dev/null' EXIT
  docker push "$IMAGE"
fi
