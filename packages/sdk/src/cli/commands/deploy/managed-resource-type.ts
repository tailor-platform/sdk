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
  | "tailordb.replication"
  | "tailordb.replication_destination"
  | "tailordb.service"
  | "tailordb.type"
  | "workflow"
  | "workflow_job_function"
  | "workflow_job_function_execution_policy";

/** How messages and prompts name each resource type. */
export const MANAGED_RESOURCE_LABELS = {
  aigateway: "AIGateway",
  application: "Application",
  "auth.connection": "Auth connection",
  "auth.hook": "Auth hook",
  "auth.idp_config": "Auth IdP config",
  "auth.machine_user": "Auth machine user",
  "auth.oauth2_client": "OAuth2 client",
  "auth.scim": "Auth SCIM config",
  "auth.scim_resource": "Auth SCIM resource",
  "auth.service": "Auth service",
  "auth.tenant_config": "Auth tenant config",
  "auth.user_profile_config": "Auth user profile config",
  executor: "Executor",
  function_registry: "Function",
  "idp.client": "IdP client",
  "idp.service": "IdP service",
  "pipeline.resolver": "Resolver",
  "pipeline.service": "Resolver namespace",
  "secret.secret": "Secret Manager secret",
  "secret.vault": "Secret Manager vault",
  staticwebsite: "StaticWebsite",
  "staticwebsite.custom_domain": "StaticWebsite custom domain",
  "staticwebsite.custom_domain_transfer": "StaticWebsite custom domain transfer",
  "tailordb.gql_permission": "TailorDB GraphQL permission",
  "tailordb.replication": "TailorDB replication",
  "tailordb.replication_destination": "TailorDB replication destination",
  "tailordb.service": "TailorDB namespace",
  "tailordb.type": "TailorDB table",
  workflow: "Workflow",
  workflow_job_function: "Workflow job",
  workflow_job_function_execution_policy: "Workflow execution policy",
} as const satisfies Record<ManagedResourceType, string>;
