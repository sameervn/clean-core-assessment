# Optional Azure external infrastructure

These examples do not provision a cluster, LLM service, Redis, or AWS resources.
The platform team can substitute its own modules. Required services are
PostgreSQL Flexible Server 16 (starter B2s, 2 vCPU/4 GiB, 32 GiB storage;
choose general-purpose/HA for production), a private Standard LRS Blob
container, and a workload identity federated against the existing cluster.
Key Vault is included for platform-managed secret distribution, not read
directly by the application. Private endpoints use existing subnets/DNS zones.

Terraform >=1.9,<2 and azurerm 4.65.0 are pinned/limited in versions.tf.
Run `terraform init -backend=false`, `terraform fmt -check -recursive`,
and `terraform validate` before review. No apply is authorized by this package.
The deploying identity needs control-plane permissions to create the listed
resources and role assignments. The provider must be able to reach private
endpoints; configure Azure AD storage authentication on the platform runner.

Copy terraform.tfvars.example to a protected, ignored tfvars file. Supply
the database administrator password through protected automation. **Sensitive
variables still appear in Terraform state.** Use an encrypted remote backend,
RBAC, locking and audited retention. No secret is emitted as an output.

After approved provisioning, a DBA creates separate migration and restricted
runtime database roles. Put their DATABASE_URL values, SESSION_SECRET and
initial CC_BOOTSTRAP_PASSWORD in Key Vault using the client's secret tooling.
Do not create fake secret resources with placeholder values. Configure External
Secrets or another approved controller to create runtime/migration Kubernetes
Secrets before Helm hooks run. Give that controller (not necessarily the app)
Key Vault Secrets User at the required scope.

Set serviceAccount.annotations.azure.workload.identity/client-id to the output
client ID and podLabels.azure.workload.identity/use to `"true"`; the existing
cluster must already have the Azure workload identity webhook. Set
CC_AZURE_STORAGE_URL and CC_AZURE_STORAGE_CONTAINER=documents. The SDK uses the
projected identity, never a secret embedded in chart values.

Review residency, backups, HA, replication, private DNS/VNet links, TLS trust,
purge protection, lifecycle and retention with the client. Uninstalling Helm
does not delete these resources. Terraform destroy is a separate destructive
operation requiring explicit approval.
