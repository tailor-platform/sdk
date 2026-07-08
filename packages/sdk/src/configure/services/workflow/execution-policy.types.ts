import type { ExecutionPolicyKey } from "#/runtime/workflow";

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
 * declared prefix; the platform registers it verbatim, or with a trailing
 * `*` appended when `enableSuffix` is set (see
 * {@link ExecutionPolicyDefInput.enableSuffix}).
 */
export interface ExecutionPolicyInstance<Key extends string = string> {
  /** Workspace-unique name for this policy. */
  readonly name: string;
  /**
   * Declared key prefix. For exact-match policies
   * ({@link ExecutionPolicyExactInstance}), this is branded and usable
   * directly as `executionPolicyKey`. For wildcard policies
   * ({@link ExecutionPolicyWildcardInstance}), this is only the prefix
   * (the platform registers it with a trailing `*`) — not a valid dispatch
   * key on its own; use `forKey` to build one.
   */
  readonly key: Key;
  /** Whether the platform registers `key` with a trailing `*` (wildcard prefix match). */
  readonly enableSuffix: boolean;
  /** Optional per-key concurrency cap. */
  readonly concurrencyPolicy?: ExecutionPolicyConcurrency;
}

/**
 * An {@link ExecutionPolicyInstance} for an exact-match policy
 * (`enableSuffix` not set). `key` is branded as {@link ExecutionPolicyKey},
 * so it can be passed directly as the `executionPolicyKey` option.
 */
export interface ExecutionPolicyExactInstance<
  Key extends string = string,
> extends ExecutionPolicyInstance<Key> {
  readonly key: Key & ExecutionPolicyKey;
  readonly enableSuffix: false;
}

/**
 * An {@link ExecutionPolicyInstance} declared with `enableSuffix: true`. The
 * platform registers `key` with a trailing `*` (wildcard prefix match); `key`
 * itself is not a valid dispatch value — use `forKey` to build a concrete,
 * branded runtime key at the call site instead of hand-concatenating the
 * prefix and a suffix.
 */
export interface ExecutionPolicyWildcardInstance<
  Key extends string = string,
> extends ExecutionPolicyInstance<Key> {
  readonly enableSuffix: true;
  /**
   * Build a concrete runtime key by appending `suffix` after this policy's
   * declared `key` prefix, separated by `.` unless a different separator was
   * configured where this policy was declared.
   * @param suffix - Value appended after the wildcard prefix
   * @returns The concrete key to pass as `executionPolicyKey`
   * @example
   * // key: "tenant-api", enableSuffix: true
   * tenantApi.forKey(tenantId); // "tenant-api.<tenantId>"
   */
  forKey(suffix: string): ExecutionPolicyKey;
}

/**
 * Resolves to {@link ExecutionPolicyWildcardInstance} when `EnableSuffix` is
 * known at the type level to be `true`, otherwise to
 * {@link ExecutionPolicyExactInstance}.
 */
export type ResolvedExecutionPolicyInstance<
  Key extends string,
  EnableSuffix extends boolean,
> = EnableSuffix extends true
  ? ExecutionPolicyWildcardInstance<Key>
  : ExecutionPolicyExactInstance<Key>;

/**
 * Body of an execution policy declaration.
 *
 * When both `name` and `key` are omitted in the `defineWorkflowExecutionPolicies`
 * builder, the property name is used verbatim for both (like
 * `defineWaitPoints`). Provide `name` when the property identifier is not
 * valid execution policy grammar, and provide `key` when the runtime key
 * prefix needs to differ from `name` (e.g. it needs `:` or `.`).
 */
export interface ExecutionPolicyDefInput {
  /** Overrides the property-name-derived `name`. 3-63 characters from `[a-z0-9-]`; must start and end with `[a-z0-9]`. */
  name?: string;
  /** Overrides the property-name-derived `key` prefix. Independent of `enableSuffix` — both may be set together. */
  key?: string;
  /**
   * Registers `key` (or the resolved `name`, if `key` is omitted) as a
   * wildcard prefix: the platform appends a trailing `*`, and the resulting
   * instance exposes `forKey(suffix)` to build concrete dispatch keys
   * instead of a directly-usable `key`.
   */
  enableSuffix?: boolean;
  /** Optional per-key concurrency cap. */
  concurrencyPolicy?: ExecutionPolicyConcurrency;
}

/**
 * Options for {@link defineWorkflowExecutionPolicies}, applying to every
 * policy declared by the builder (not settable per policy).
 */
export interface ExecutionPolicyGroupOptions {
  /**
   * Separator `forKey(suffix)` inserts between a wildcard policy's declared
   * `key` prefix and `suffix`. Defaults to `.`.
   */
  separator?: string;
}
