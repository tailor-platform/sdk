// Application configuration input types for defineConfig().
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { AIGatewayConfig } from "#/configure/services/aigateway/types";
import type { AuthConfig } from "#/configure/services/auth/types";
import type { IdPConfig } from "#/configure/services/idp/types";
import type { ResolverPermission } from "#/configure/services/resolver/permission";
import type { SecretsConfig } from "#/configure/services/secrets/types";
import type { StaticWebsiteConfig } from "#/configure/services/staticwebsite/types";
import type { TailorDBServiceInput } from "#/configure/services/tailordb/types";
import type { ExecutionPolicyInstance } from "#/configure/services/workflow/execution-policy.types";
import type { LogLevelEnum } from "#/types/app-config.generated";

export type LogLevel = LogLevelEnum;
export type LogLevelInput = LogLevel | (string & {});

/**
 * Node-only globals that installed packages may reference without failing
 * `deploy`, keyed by package name (e.g. `"@ai-sdk/gateway"`). List the globals, or set
 * `true` to allow every one of them — including any the package only starts
 * referencing in a later version.
 */
export type AllowedRuntimeGlobals = Record<string, true | string[]>;

/** Options for how `defineConfig()` bundles functions. */
export interface BuildOptions {
  /**
   * Enable inline sourcemaps in bundled functions for better error stack traces.
   * @default true
   */
  inlineSourcemap?: boolean;
  /**
   * Controls which `console.*` and `logger.*` (from `@tailor-platform/sdk/runtime`)
   * calls remain in bundled functions. `logger.setAttributes` has no severity and
   * is never dropped.
   * @default "DEBUG"
   */
  logLevel?: LogLevelInput;
  /**
   * Lets `deploy` continue when an installed package bundled into a resolver,
   * executor, or workflow references a Node-only global such as `process` or
   * `Buffer`, which the Tailor Platform runtime does not define. Allow a global
   * only after confirming that the package's code referencing it never runs for
   * your use, since that code throws a `ReferenceError` at runtime. Only code
   * from installed packages is affected: a reference from the project's own
   * code always fails the build.
   * @example
   * allowedRuntimeGlobals: {
   *   "@ai-sdk/gateway": ["Buffer"],
   *   "some-trusted-package": true,
   * }
   */
  allowedRuntimeGlobals?: AllowedRuntimeGlobals;
}

/** Value an `env` entry resolves to at runtime. */
export type EnvValue = string | number | boolean;

/**
 * An `env` value that credential detection flags, allowed through together with
 * the reason it is safe to deploy as plaintext.
 *
 * Booleans are excluded: `true` and `false` match no credential format and are
 * far too short for the randomness heuristic, so they are never flagged.
 */
type AllowedSecretEnvValue = {
  value: Exclude<EnvValue, boolean>;
  /** Why this value is safe to deploy as plaintext even though it looks like a credential. */
  allowSecretReason: string;
};

/** An entry of `defineConfig({ env })`. */
export type EnvEntry = EnvValue | AllowedSecretEnvValue;

/** `files`/`ignores` patterns are resolved relative to this config's own directory, not the invocation directory. */
export type ExecutorServiceConfig = { files: string[]; ignores?: string[] };
export type ExecutorServiceInput = ExecutorServiceConfig;

/** `files`/`ignores` patterns are resolved relative to this config's own directory, not the invocation directory. */
export type HttpAdapterServiceInput = { files: string[]; ignores?: string[] };

export type ResolverServiceConfig = {
  /** `files`/`ignores` patterns are resolved relative to this config's own directory, not the invocation directory. */
  files: string[];
  ignores?: string[];
  /**
   * Access requirement applied to every resolver in this namespace that
   * declares no `permission` of its own. Takes the same values as a
   * resolver's `permission`, including `"allowAnonymous"` to record that the
   * namespace is public by design.
   *
   * A resolver's own `permission` replaces this default rather than merging
   * with it, so a single resolver opts out with `permission: "allowAnonymous"`.
   */
  defaultPermission?: ResolverPermission;
};
export type ResolverExternalConfig = { external: true };
export type ResolverServiceInput = {
  [namespace: string]: ResolverServiceConfig | ResolverExternalConfig;
};

export type WorkflowServiceConfig = {
  /** Resolved relative to this config's own directory, not the invocation directory. */
  files: string[];
  job_files?: string[];
  ignores?: string[];
  job_ignores?: string[];
  /** Workspace-level execution policies for workflow job functions. */
  executionPolicies?: Record<string, ExecutionPolicyInstance>;
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
 * - `aiGateways`: Array of AI Gateway configs, e.g. `[gateway]`
 * - `db`, `resolver`, `executor`, `workflow`, `httpAdapter`: Service configs with file globs (resolved relative to this config file's own directory, not the invocation directory)
 */
export interface AppConfig<
  Auth extends AuthConfig = AuthConfig,
  Idp extends IdPConfig[] = IdPConfig[],
  StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
  AIGateways extends AIGatewayConfig[] = AIGatewayConfig[],
  Env extends Record<string, EnvEntry> = Record<string, EnvEntry>,
> {
  /** Application name (required). */
  name: string;
  /**
   * Stable identifier used to track the application across renames.
   * Managed by the SDK and assigned on the first local `deploy`. Projects
   * that use `tailor setup` keep it in `.github/tailor.lock` under `appIds`
   * and leave this field unset; other projects get it written here. Delete
   * this field if you want the SDK to assign a new id on the next `deploy`
   * — typical case: `tailor.config.ts` was copied from another project and
   * the new application should not share the original's id. Existing
   * resources are re-tagged with the new id; data is preserved.
   */
  id?: string;
  /**
   * Environment variables accessible via `context.env` in resolvers and via the second argument `{ env }` in workflow job bodies.
   *
   * A value that looks like a credential is rejected, since `env` is deployed
   * as plaintext. When the detection is wrong about a value, wrap it as
   * `{ value, allowSecretReason }` to allow it and record why it is safe. Real
   * credentials belong in `defineSecretManager()`.
   */
  env?: Env;
  /** Allowed CORS origins. Must be an array of strings, e.g. `["https://example.com"]`. */
  cors?: string[];
  /** IP addresses allowed to access the application. */
  allowedIpAddresses?: string[];
  /** Disable GraphQL introspection in production. */
  disableIntrospection?: boolean;
  /**
   * Extra labels written to the deployed application's metadata, alongside the
   * labels the SDK writes itself. Use it to record information about the
   * application that tooling reads back from the platform, e.g. the version of
   * a framework the config is generated from.
   *
   * Keys must match `^[a-z][a-z0-9_-]{0,62}$` and must not start with `sdk-`.
   * Values must be empty or match `^[a-z][a-z0-9_-]{0,62}$`, so a version like
   * `1.2.3` is written as `v1-2-3`. At most 17 entries can be set.
   *
   * Entries are only added or overwritten: an entry removed from this config
   * keeps its last deployed value on the platform. Those retained labels count
   * towards the platform's limit of 20 labels per resource, so `deploy` stops
   * before changing the application when the total would exceed it.
   */
  metadata?: Record<string, string>;
  /** TailorDB service configuration with table definition files. */
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
  /** AI Gateway configurations. Must be an array, e.g. `[gateway]`. */
  aiGateways?: AIGateways;
  /** Secret Manager vault configurations. Keys are vault names, values are records of secret names to values. */
  secrets?: SecretsConfig;
  /**
   * Enable inline sourcemaps in bundled functions for better error stack traces.
   * @default true
   * @deprecated since 2.24.0 — use `buildOptions.inlineSourcemap` instead. codemod: v3/define-config-build-options
   */
  inlineSourcemap?: boolean;
  /**
   * Controls which `console.*` and `logger.*` (from `@tailor-platform/sdk/runtime`)
   * calls remain in bundled functions.
   * @default "DEBUG"
   * @deprecated since 2.24.0 — use `buildOptions.logLevel` instead. codemod: v3/define-config-build-options
   */
  logLevel?: LogLevelInput;
  /** Options for how resolvers, executors, workflow jobs, and other functions are bundled. */
  buildOptions?: BuildOptions;
  /**
   * Value representation of `t.date()`, `t.datetime()`, and `t.time()` fields
   * that omit `as`. `"temporal"` gives them `Temporal.PlainDate`,
   * `Temporal.Instant`, and `Temporal.PlainTime` values; `"date"` gives them
   * `Date` values. Applied in every bundled function and in the
   * `tailor-runtime` Vitest environment. A field's own `as` takes precedence.
   * Run `tailor generate` after changing it so `tailor.d.ts` updates the field
   * types.
   * @example defaultDateRepresentation: "temporal"
   */
  defaultDateRepresentation?: "temporal" | "date";
  /**
   * Whether `deploy` puts the TailorDB namespaces that have pending migrations
   * into maintenance mode while it applies them. In maintenance mode, the
   * generated GraphQL create, update, delete, and bulk upsert operations of
   * every table in those namespaces are disabled and record events are not
   * published; `read` keeps its setting.
   *
   * - `false` (default): no maintenance mode. While migrations run, the SDK does
   *   not guarantee what concurrent requests observe: tables can be in an
   *   intermediate schema, and record writes made by migration scripts publish
   *   events to the executors of the previous deploy.
   * - `"migration"`: maintenance mode from the first pending migration until the
   *   last one completes.
   * - `"deploy"`: maintenance mode from the first pending migration until the
   *   deploy has applied every other change, including resolvers, executors,
   *   and workflows.
   *
   * A deploy without pending migrations never enters maintenance mode.
   * @example maintenanceMode: "migration"
   */
  maintenanceMode?: false | "migration" | "deploy";
}
