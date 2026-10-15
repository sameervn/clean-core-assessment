variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "administrator_login" { type = string }
variable "password" {
  type      = string
  sensitive = true
}
variable "subnet_id" { type = string }
variable "private_dns_zone_id" { type = string }
variable "sku" { type = string }
variable "storage_mb" { type = number }
terraform {
  required_providers {
    azurerm = { source = "hashicorp/azurerm" }
  }
}
resource "azurerm_postgresql_flexible_server" "this" {
  name                          = var.name
  location                      = var.location
  resource_group_name           = var.resource_group_name
  version                       = "16"
  administrator_login           = var.administrator_login
  administrator_password        = var.password
  delegated_subnet_id            = var.subnet_id
  private_dns_zone_id            = var.private_dns_zone_id
  public_network_access_enabled = false
  sku_name                      = var.sku
  storage_mb                    = var.storage_mb
  backup_retention_days         = 14
}
resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "clean_core"
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
output "fqdn" { value = azurerm_postgresql_flexible_server.this.fqdn }
