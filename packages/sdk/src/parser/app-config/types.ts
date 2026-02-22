import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import type { StaticWebsiteConfig } from "@/configure/services/staticwebsite";
import type { WorkflowServiceInput } from "@/configure/services/workflow/types";
import type { AuthConfig } from "@/parser/service/auth/types";
import type { IdPConfig } from "@/parser/service/idp/types";
import type { ResolverServiceInput } from "@/parser/service/resolver/types";
import type { TailorDBServiceInput } from "@/parser/service/tailordb/types";

/**
 * Application configuration for `defineConfig()`.
 *
 * Key fields:
 * - `name` (required): Application name
 * - `cors`: Array of allowed origins, e.g. `["https://example.com"]`
 * - `auth`: Single auth config object (not an array)
 * - `idp`: Array of IdP configs, e.g. `[myIdp]`
 * - `staticWebsites`: Array of static website configs, e.g. `[website]`
 * - `db`, `resolver`, `executor`, `workflow`: Service configs with file globs
 */
export interface AppConfig<
  Auth extends AuthConfig = AuthConfig,
  Idp extends IdPConfig[] = IdPConfig[],
  StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
  Env extends Record<string, string | number | boolean> = Record<string, string | number | boolean>,
> {
  /** Application name (required). */
  name: string;
  /** Environment variables accessible via `context.env` in resolvers and via the second argument `{ env }` in workflow job bodies. */
  env?: Env;
  /** Allowed CORS origins. Must be an array of strings, e.g. `["https://example.com"]`. */
  cors?: string[];
  /** IP addresses allowed to access the application. */
  allowedIpAddresses?: string[];
  /** Disable GraphQL introspection in production. */
  disableIntrospection?: boolean;
  /** TailorDB service configuration with type definition files. */
  db?: TailorDBServiceInput;
  /** Resolver service configuration with resolver files. */
  resolver?: ResolverServiceInput;
  /** Identity Provider configurations. Must be an array, e.g. `[myIdp]`. */
  idp?: Idp;
  /** Auth configuration (single object, not an array). */
  auth?: Auth;
  /** Executor service configuration with executor files. */
  executor?: ExecutorServiceInput;
  /** Workflow service configuration with workflow files. */
  workflow?: WorkflowServiceInput;
  /** Static website configurations. Must be an array, e.g. `[website]`. */
  staticWebsites?: StaticWebsites;
}
