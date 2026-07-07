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
 * `name` is the workspace-unique identifier (`[a-z0-9-]`). `key` is the
 * runtime lookup value the workflow passes through the `executionPolicyKey`
 * option on `tailor.workflow.triggerJobFunction()`; it may contain
 * characters not permitted in a `name` (e.g., `:`, `.`, or a trailing `*`
 * for wildcard policies).
 */
export interface ExecutionPolicyInstance {
  /** Workspace-unique name for this policy. */
  readonly name: string;
  /**
   * Runtime lookup key. For exact-match policies, pass this value as the
   * `executionPolicyKey` option on `tailor.workflow.triggerJobFunction()`.
   * For wildcard policies (key ending with `*`), construct the concrete key
   * at runtime (e.g., `` `tenant-api.${tenantId}` ``).
   */
  readonly key: string;
  /** Optional per-key concurrency cap. */
  readonly concurrencyPolicy?: ExecutionPolicyConcurrency;
}

/**
 * Body of an execution policy declaration.
 *
 * When both `name` and `key` are omitted in the `defineWorkflowExecutionPolicies`
 * builder, the property name is used verbatim for both (like
 * `defineWaitPoints`). Provide `name` when the property identifier is not
 * valid execution policy grammar, and provide `key` when the runtime key
 * must contain `:`, `.`, or a trailing `*`.
 */
export interface ExecutionPolicyDefInput {
  /** Overrides the property-name-derived `name`. 3-63 characters from `[a-z0-9-]`; must start and end with `[a-z0-9]`. */
  name?: string;
  /** Overrides the property-name-derived `key`. Required when the key contains `:`, `.`, or a trailing `*`. */
  key?: string;
  /** Optional per-key concurrency cap. */
  concurrencyPolicy?: ExecutionPolicyConcurrency;
}
