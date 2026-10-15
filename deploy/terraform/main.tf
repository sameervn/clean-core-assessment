# Existing cluster, network and private DNS are owned by the platform team.
data "azurerm_resource_group" "client" { name = var.resource_group_name }
module "database" {
  source              = "./modules/database"
  name                = "${var.prefix}-postgres"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.client.name
  administrator_login = var.postgres_admin
  password            = var.postgres_password
  subnet_id           = var.postgres_subnet_id
  private_dns_zone_id = var.postgres_private_dns_zone_id
  sku                 = var.postgres_sku
  storage_mb          = var.postgres_storage_mb
}
module "documents" {
  source              = "./modules/documents"
  name                = var.storage_account_name
  location            = var.location
  resource_group_name = data.azurerm_resource_group.client.name
  subnet_id           = var.private_endpoint_subnet_id
  private_dns_zone_id = var.blob_private_dns_zone_id
}
resource "azurerm_user_assigned_identity" "app" {
  name                = "${var.prefix}-app"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.client.name
}
resource "azurerm_federated_identity_credential" "app" {
  name                = "${var.prefix}-cluster"
  resource_group_name = data.azurerm_resource_group.client.name
  parent_id           = azurerm_user_assigned_identity.app.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = var.cluster_oidc_issuer
  subject             = "system:serviceaccount:${var.namespace}:${var.service_account}"
}
resource "azurerm_role_assignment" "documents" {
  scope                = module.documents.container_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}
resource "azurerm_key_vault" "client" {
  name                          = var.vault_name
  location                      = var.location
  resource_group_name           = data.azurerm_resource_group.client.name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = false
}
resource "azurerm_private_endpoint" "vault" {
  name                = "${var.prefix}-vault-private"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.client.name
  subnet_id           = var.private_endpoint_subnet_id
  private_service_connection {
    name                           = "vault"
    private_connection_resource_id = azurerm_key_vault.client.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "vault"
    private_dns_zone_ids = [var.vault_private_dns_zone_id]
  }
}
