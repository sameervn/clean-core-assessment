variable "subscription_id" { type = string }
variable "tenant_id" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "prefix" { type = string }
variable "postgres_admin" { type = string }
variable "postgres_password" {
  type      = string
  sensitive = true
}
variable "postgres_subnet_id" {
  type        = string
  description = "Existing subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers"
}
variable "postgres_private_dns_zone_id" { type = string }
variable "private_endpoint_subnet_id" { type = string }
variable "blob_private_dns_zone_id" { type = string }
variable "vault_private_dns_zone_id" { type = string }
variable "cluster_oidc_issuer" { type = string }
variable "namespace" { type = string }
variable "service_account" { type = string }
variable "storage_account_name" { type = string }
variable "vault_name" { type = string }
variable "postgres_sku" {
  type    = string
  default = "B_Standard_B2s"
}
variable "postgres_storage_mb" {
  type    = number
  default = 32768
}
