import type { AuthConfig } from "./auth";
import type { IdPConfig } from "./idp";
import type { SecretsConfig } from "./secrets-config";
import type { StaticWebsiteConfig } from "./staticwebsite-config";
import type { TailorDBServiceInput } from "./tailordb";

export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR", "SILENT"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogLevelInput = LogLevel | (string & {});

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export type ExecutorServiceConfig = { files: string[]; ignores?: string[] };
export type ExecutorServiceInput = ExecutorServiceConfig;

export type HttpAdapterServiceInput = { files: string[]; ignores?: string[] };

export type ResolverServiceConfig = { files: string[]; ignores?: string[] };
export type ResolverExternalConfig = { external: true };
export type ResolverServiceInput = {
  [namespace: string]: ResolverServiceConfig | ResolverExternalConfig;
};

export type WorkflowServiceConfig = {
  files: string[];
  job_files?: string[];
  ignores?: string[];
  job_ignores?: string[];
};
export type WorkflowServiceInput = WorkflowServiceConfig;

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
  /**
   * Stable identifier used to track the application across renames.
   * Managed by the SDK: auto-generated and written into `tailor.config.ts`
   * on first `deploy`. Delete this field if you want the SDK to assign a
   * new id on the next `deploy` — typical case: `tailor.config.ts` was
   * copied from another project and the new application should not share
   * the original's id. Existing resources are re-tagged with the new id;
   * data is preserved.
   */
  id?: string;
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
  /** HTTP adapter service configuration with adapter files. */
  httpAdapter?: HttpAdapterServiceInput;
  /** Static website configurations. Must be an array, e.g. `[website]`. */
  staticWebsites?: StaticWebsites;
  /** Secret Manager vault configurations. Keys are vault names, values are records of secret names to values. */
  secrets?: SecretsConfig;
  /**
   * Enable inline sourcemaps in bundled functions for better error stack traces.
   * @default true
   */
  inlineSourcemap?: boolean;
  /**
   * Controls which console log calls remain in bundled functions.
   * @default "DEBUG"
   */
  logLevel?: LogLevelInput;
}
