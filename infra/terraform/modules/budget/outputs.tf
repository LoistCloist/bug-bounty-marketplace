output "id" {
  description = "Budget resource ID."
  value       = local.rg_scoped ? azurerm_consumption_budget_resource_group.this[0].id : azurerm_consumption_budget_subscription.this[0].id
}
