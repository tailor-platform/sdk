import type { ExecutionPolicyKey } from "#/runtime/workflow";

/**
 * Optional per-key concurrency cap applied to job function dispatches that
 * resolve to a policy's `executionPolicyKey`.
 */
export interface ExecutionPolicyConcurrency {
  /** Maximum number of concurrent executions allowed per resolved key. */
  maxConcurrentExecutions: number;
}

/** Fields shared by both {@link ExecutionPolicyExactInstance} and {@link ExecutionPolicyWildcardInstance}. */
interface ExecutionPolicyBase {
  /** Workspace-unique name for this policy. */
  readonly name: string;
  /** Optional per-key concurrency cap. */
  readonly concurrencyPolicy?: ExecutionPolicyConcurrency;
}

/**
 * An execution policy declared with `matchType: "exact"` (the default).
 * `key` is branded as {@link ExecutionPolicyKey}, so it can be passed
 * directly as the `executionPolicyKey` option.
 */
export interface ExecutionPolicyExactInstance<
  Key extends string = string,
> extends ExecutionPolicyBase {
  /** Declared key; the platform registers it verbatim. */
  readonly key: Key & ExecutionPolicyKey;
  readonly matchType: "exact";
}

/**
 * An execution policy declared with `matchType: "prefix"`. The platform
 * registers the declared key prefix with a trailing `*`, and matches every
 * dispatch whose runtime key begins with that prefix. There is no
 * directly-usable `key` — use `keyFor` to build a concrete, branded runtime
 * key at the call site instead of hand-concatenating the prefix and a
 * suffix.
 */
export interface ExecutionPolicyWildcardInstance extends ExecutionPolicyBase {
  readonly matchType: "prefix";
  /**
   * Build a concrete runtime key by appending `suffix` after this policy's
   * declared key prefix, separated by `.` unless a different separator was
   * configured where this policy was declared.
   * @param suffix - Value appended after the wildcard prefix
   * @returns The concrete key to pass as `executionPolicyKey`
   * @throws If the resulting key does not match the execution policy key
   * grammar (for example, an empty `suffix`)
   * @example
   * // key: "tenant-api", matchType: "prefix"
   * tenantApi.keyFor(tenantId); // "tenant-api.<tenantId>"
   */
  keyFor(suffix: string): ExecutionPolicyKey;
}

/**
 * A declared workflow job function execution policy — either
 * {@link ExecutionPolicyExactInstance} or {@link ExecutionPolicyWildcardInstance}.
 */
export type ExecutionPolicyInstance<Key extends string = string> =
  | ExecutionPolicyExactInstance<Key>
  | ExecutionPolicyWildcardInstance;

/**
 * Resolves to {@link ExecutionPolicyWildcardInstance} when `MatchType` is
 * known at the type level to be `"prefix"`, to {@link ExecutionPolicyExactInstance}
 * when it's known to be `"exact"`, or to their union when `MatchType` is the
 * unnarrowed `"exact" | "prefix"` (e.g. a caller passed a non-literal
 * `matchType`) — narrowing to one branch in that case would claim a `key` or
 * `keyFor` that may not exist on the actual runtime instance.
 */
export type ResolvedExecutionPolicyInstance<
  Key extends string,
  MatchType extends "exact" | "prefix",
> = "exact" | "prefix" extends MatchType
  ? ExecutionPolicyExactInstance<Key> | ExecutionPolicyWildcardInstance
  : MatchType extends "prefix"
    ? ExecutionPolicyWildcardInstance
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
  /** Overrides the property-name-derived `key` prefix. Independent of `matchType` — both may be set together. */
  key?: string;
  /**
   * `"exact"` (the default) matches a dispatch whose runtime key equals
   * `key` (or the resolved `name`, if `key` is omitted). `"prefix"`
   * registers `key` as a wildcard prefix — the platform appends a trailing
   * `*`, and the resulting instance exposes `keyFor(suffix)` to build
   * concrete dispatch keys instead of a directly-usable `key`.
   */
  matchType?: "exact" | "prefix";
  /** Optional per-key concurrency cap. */
  concurrencyPolicy?: ExecutionPolicyConcurrency;
}

/**
 * Options for {@link defineWorkflowExecutionPolicies}, applying to every
 * policy declared by the builder (not settable per policy).
 */
export interface ExecutionPolicyGroupOptions {
  /**
   * Separator `keyFor(suffix)` inserts between a wildcard policy's declared
   * `key` prefix and `suffix`. Defaults to `.`.
   */
  separator?: string;
}
