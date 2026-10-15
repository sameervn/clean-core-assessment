# CI installation

Neither sample is active automatically. GitHub: copy github-actions.yml into
.github/workflows/clean-core.yml. Azure DevOps: create a pipeline selecting
deploy/ci/azure-pipelines.yml, create the client-approved Environment, and
configure its required approvals. GitHub also needs required reviewers on
client-approved. Do not enable deployment without those approval controls.

Both samples run the same image.sh and chart checks: build linux/amd64, fail on
Trivy CRITICAL, emit a Syft SPDX JSON SBOM, then optionally authenticate/push.
Tools/images/actions have explicit versions, not latest. Azure hosted tasks
support major version pinning only; client organizations requiring immutable
task binaries should supply vetted private tasks or a pinned build-agent image.
Review and refresh scanner databases/tool versions as part of release policy.

Configure REGISTRY (hostname), IMAGE_REPOSITORY, KUBE_NAMESPACE and
CLIENT_VALUES_FILE (reviewed values file in this repository). Store registry
credentials as protected CI secrets; use short-lived federation instead when
the platform supplies it. Provision namespace, workload identities, runtime and
migration Secrets, CA ConfigMaps and image pull credentials before deployment.
Both release commands force migration.enabled=true after the client values
file is loaded. Set migration.serviceAccountName to a pre-existing migration
service account and migration.existingSecret to its pre-existing database
Secret. A missing identity fails the render instead of silently skipping DDL.
The samples never put application secrets into values or image build arguments.

For mounted `.env` delivery, enable `runtimeEnvFile.enabled` and
`migration.runtimeEnvFile.enabled` in CLIENT_VALUES_FILE and provide their
pre-existing Secret names and keys. See [Deere handoff](../DEERE-GATEWAY.md).
The migration Secret must contain its own privileged DATABASE_URL, not the
runtime account URL. Provision files through the approved secret manager before
hooks run. Do not echo secrets, upload env files as CI artifacts, enable shell
tracing, use Helm `--set-file`, or put credentials in Helm values/arguments.
`AI_GATEWAY_CLIENT_SECRET` is secret-only; chart validation rejects it in config.
GitHub protected secrets are an acceptable source for the client's separate
Secret-sync job, not image build input.

GitHub deploy reads a protected KUBECONFIG_CONTENT secret; Azure reads the
client-kubeconfig secure file. Scope access to the intended namespace and
delete/rotate temporary credentials. A platform-managed runner with short-lived
identity is preferred. Registry, cluster and private DB access must exist from
the approved runners. No image push or client deployment was performed while
preparing these samples.
