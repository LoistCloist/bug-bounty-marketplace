resource "azurerm_container_registry" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku
  # Pulls/pushes use Entra identities (AcrPull/AcrPush), never the admin user.
  admin_enabled = false
  tags          = var.tags
}
