// Parsed workspace configuration shared by the parser and the CLI.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type {
  AppConfig,
  EnvEntry,
  ExecutorServiceConfig,
  ResolverServiceConfig,
  WorkflowServiceConfig,
} from "#/configure/config/types";
import type { AuthOwnConfig } from "#/configure/services/auth/types";
import type { IdPOwnConfig } from "#/configure/services/idp/types";
import type { TailorDBOwnServiceConfigInput } from "#/configure/services/tailordb/types";

/** An application of a workspace: the services it exposes, by name, and its own settings. */
export interface WorkspaceApplication extends Pick<
  AppConfig,
  "cors" | "allowedIpAddresses" | "disableIntrospection" | "metadata"
> {
  db: string[];
  resolver: string[];
  auth?: string;
  idp?: string;
}

/** `env` values a service namespace overrides, keyed by the root `env` key they replace. */
export type EnvOverride<Value = EnvEntry> = Record<string, Value>;

/**
 * A `defineWorkspace()` or `defineApp()` config in one shape: services keyed by name, with the
 * `env` overrides split out of their entries, and the applications that expose them.
 */
export interface ParsedWorkspaceConfig<Value = EnvEntry> extends Pick<
  AppConfig,
  | "httpAdapter"
  | "staticWebsites"
  | "aiGateways"
  | "secrets"
  | "buildOptions"
  | "defaultDateRepresentation"
  | "maintenanceMode"
> {
  env: Record<string, Value>;
  db: Record<string, TailorDBOwnServiceConfigInput>;
  resolver: Record<string, ResolverServiceConfig>;
  executor?: ExecutorServiceConfig;
  workflow?: WorkflowServiceConfig;
  auth: Record<string, AuthOwnConfig>;
  idp: Record<string, IdPOwnConfig>;
  envOverrides: {
    resolver: Record<string, EnvOverride<Value>>;
    executor?: EnvOverride<Value>;
    workflow?: EnvOverride<Value>;
    auth: Record<string, EnvOverride<Value>>;
  };
  apps: Record<string, WorkspaceApplication>;
}
