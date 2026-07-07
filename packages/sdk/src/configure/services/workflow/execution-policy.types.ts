/**
 * Optional per-key concurrency cap applied to job function dispatches that
 * resolve to a policy's `executionPolicyKey`.
 */
export interface ExecutionPolicyConcurrency {
  /** Maximum number of concurrent executions allowed per resolved key. */
  maxConcurrentExecutions: number;
}

/**
 * A workflow job function execution policy declaration.
 *
 * `name` is the workspace-unique identifier embedded in the resource TRN
 * (`[a-z0-9-]`). `key` is the runtime lookup value passed to
 * `TailorWorkflowAPI.triggerJobFunction` through the `executionPolicyKey`
 * option; it may contain characters not permitted in a `name` (e.g., `:`,
 * `.`, or a trailing `*` for wildcard policies).
 */
export interface ExecutionPolicyInstance {
  /** Workspace-unique name embedded in the resource TRN. */
  readonly name: string;
  /**
   * Runtime lookup key. For exact-match policies, pass this value directly to
   * `triggerJobFunction`. For wildcard policies (key ending with `*`),
   * construct the concrete key at runtime (e.g., `` `tenant-api.${tenantId}` ``).
   */
  readonly key: string;
  /** Optional per-key concurrency cap. */
  readonly concurrencyPolicy?: ExecutionPolicyConcurrency;
}

/**
 * Body of an execution policy declaration.
 *
 * When both `name` and `key` are omitted in the `defineWorkflowExecutionPolicies`
 * builder, the property name (camelCase → kebab-case) is used for both.
 * Provide `key` explicitly when the runtime key must contain `:`, `.`, or a
 * trailing `*`.
 */
export interface ExecutionPolicyDefInput {
  /** Overrides the property-name-derived `name`. Grammar: `[a-z0-9-]{3,63}`. */
  name?: string;
  /** Overrides the property-name-derived `key`. Required when the key contains `:`, `.`, or a trailing `*`. */
  key?: string;
  /** Optional per-key concurrency cap. */
  concurrencyPolicy?: ExecutionPolicyConcurrency;
}
