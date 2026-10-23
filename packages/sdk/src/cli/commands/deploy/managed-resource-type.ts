/**
 * Stable resource kind identifier. `deploy --dry-run --json` reports it as
 * `resourceType`, so existing values must not change.
 */
export type ManagedResourceType =
  | "aigateway"
  | "application"
  | "auth.connection"
  | "auth.hook"
  | "auth.idp_config"
  | "auth.machine_user"
  | "auth.oauth2_client"
  | "auth.scim"
  | "auth.scim_resource"
  | "auth.service"
  | "auth.tenant_config"
  | "auth.user_profile_config"
  | "executor"
  | "function_registry"
  | "idp.client"
  | "idp.service"
  | "pipeline.resolver"
  | "pipeline.service"
  | "secret.secret"
  | "secret.vault"
  | "staticwebsite"
  | "staticwebsite.custom_domain"
  | "staticwebsite.custom_domain_transfer"
  | "tailordb.gql_permission"
  | "tailordb.service"
  | "tailordb.type"
  | "workflow"
  | "workflow_job_function"
  | "workflow_job_function_execution_policy";
