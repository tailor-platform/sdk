// Parsed workspace configuration shared by the parser and the CLI.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type {
  ApplicationSettings,
  EnvEntry,
  ExecutorServiceConfig,
  ResolverServiceConfig,
  WorkflowServiceConfig,
  WorkspaceSettings,
} from "#/configure/config/types";
import type { AuthOwnConfig } from "#/configure/services/auth/types";
import type { IdPOwnConfig } from "#/configure/services/idp/types";
import type { TailorDBOwnServiceConfigInput } from "#/configure/services/tailordb/types";

/** An application of a workspace: the services it exposes, by name, and its own settings. */
export interface WorkspaceApplication extends ApplicationSettings {
  db: string[];
  resolver: string[];
  auth?: string;
  idp?: string;
}

/**
 * A `defineWorkspace()` or `defineApp()` config in one shape: services keyed by name, with the
 * `env` overrides split out of their entries, and the applications that expose them.
 */
export interface WorkspaceRepresentation<Value = EnvEntry> extends WorkspaceSettings {
  env: Record<string, Value>;
  db: Record<string, TailorDBOwnServiceConfigInput>;
  resolver: Record<string, ResolverServiceConfig>;
  executor?: ExecutorServiceConfig;
  workflow?: WorkflowServiceConfig;
  auth: Record<string, AuthOwnConfig>;
  idp: Record<string, IdPOwnConfig>;
  /** `env` values each service uses in place of the root values with the same keys. */
  envOverrides: {
    resolver: Record<string, Record<string, Value>>;
    executor?: Record<string, Value>;
    workflow?: Record<string, Value>;
    auth: Record<string, Record<string, Value>>;
  };
  apps: Record<string, WorkspaceApplication>;
}
