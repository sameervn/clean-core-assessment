# Client decisions required before deployment

- Which Kubernetes distribution/platform/version and support policy? OpenShift
  restricted SCC/arbitrary UID? Existing ingress, metrics server and identity
  webhooks? Approved CPU/memory limits and availability target?
- Which registry/repository, immutable tags/signatures, imagePullSecrets,
  vulnerability severity gate and SBOM/license retention policy?
- Helm directly, GitOps or ArgoCD? Who owns release approvals, namespaces,
  hook ordering, rollback decisions and backup restore exercises?
- Dedicated host, ingress class/annotations, DNS, TLS/cert-manager or existing
  certificate? Body size and timeout limits? WAF/access-log capability redaction?
- Which secret tooling: existing Secrets, External Secrets, Key Vault,
  AWS Secrets Manager or another platform? Who creates runtime/migration
  Secrets before hooks, rotates credentials and triggers rollouts?
- PostgreSQL service/version/region: Azure Flexible Server, RDS or existing
  PostgreSQL? Endpoint/port/database, verified CA and rotation procedure?
  Private DNS/VPC/VNet routing, security groups, pool budget/connection limits,
  DBA ownership and distinct migration/runtime roles?
- Storage: private S3 with versioning, Azure Blob, native GCS, Replit or
  explicitly single-replica local PVC? Bucket/container/prefix, region,
  encryption/KMS, workload identity, retained versions/lifecycle, backup and
  deletion policy? Is a non-EKS cluster using federation or a credential broker?
- For RDS + S3, confirm they are separate services: relational metadata in RDS,
  document/template bytes in S3, assessments unchanged in the user's browser.
  Is automatic transfer of any existing data a separate approved project?
- Is AI enabled? Approved OpenAI model or Azure deployment/API version/region?
  Are consented payloads allowed to leave this network/residency boundary?
  Is an HTTPS Redis REST limiter available for multiple replicas/HPA?
- What outbound DNS/DB/storage/identity/LLM/limiter restrictions apply? Private
  endpoints? STS/Azure identity exchange allowed? Browser Google Fonts allowed?
  Does the CNI support FQDN policies or is an egress proxy required?
- Who owns Terraform state, Azure subscription/resource group, delegated
  subnets/private DNS, role assignments, module substitutions and cost approval?
  Are sample sizing/retention settings acceptable? No cluster/LLM is provisioned.
- Which client-approved environments may be used to test real Azure/AWS/GCS
  connectivity, conditional deletes, certificate rotation and failure recovery?
- What are recovery objectives, log retention/redaction, audit access policy
  and data residency requirements for DB, objects, backups and browser exports?
