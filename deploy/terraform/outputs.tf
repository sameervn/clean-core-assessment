output "postgres_hostname" { value = module.database.fqdn }
output "blob_endpoint" { value = module.documents.endpoint }
output "workload_client_id" { value = azurerm_user_assigned_identity.app.client_id }
output "vault_uri" { value = azurerm_key_vault.client.vault_uri }
