import { brandValue } from "#/utils/brand";
import type {
  ExecutionPolicyConcurrency,
  ExecutionPolicyDefInput,
  ExecutionPolicyInstance,
  ResolvedExecutionPolicyInstance,
} from "./execution-policy.types";

export type {
  ExecutionPolicyConcurrency,
  ExecutionPolicyDefInput,
  ExecutionPolicyExactInstance,
  ExecutionPolicyInstance,
  ExecutionPolicyWildcardInstance,
  ResolvedExecutionPolicyInstance,
} from "./execution-policy.types";

// Resolves to the literal type of `Def["key"]` when the caller passed an
// explicit `key`, otherwise to `Fallback`.
type ResolveKey<Def, Fallback extends string> = Def extends { key: infer K extends string }
  ? K
  : Fallback;

// Resolves to the literal type of `Def["enableSuffix"]`, defaulting to
// `false`. Always known from `def` directly — never derived from a property
// name — so it resolves the same way regardless of where `key` comes from.
type ResolveEnableSuffix<Def> = Def extends { enableSuffix: infer E extends boolean } ? E : false;

interface ExecutionPolicyWithSetters {
  instance: ExecutionPolicyInstance;
  setName: ((name: string) => void) | undefined;
  setKey: ((key: string) => void) | undefined;
}

function createExecutionPolicyInstance(
  initialName: string,
  initialKey: string,
  concurrencyPolicy: ExecutionPolicyConcurrency | undefined,
  enableSuffix: boolean,
  allowNameSetter: boolean,
  allowKeySetter: boolean,
): ExecutionPolicyWithSetters {
  const raw: {
    name: string;
    key: string;
    enableSuffix: boolean;
    concurrencyPolicy?: ExecutionPolicyConcurrency;
    forKey?: (suffix: string) => string;
  } = {
    name: initialName,
    key: initialKey,
    enableSuffix,
    ...(concurrencyPolicy && { concurrencyPolicy }),
    // Reads raw.key (not the initialKey param) so a property-name-derived
    // key patched in later via setKey is reflected too.
    ...(enableSuffix && { forKey: (suffix: string) => `${raw.key}.${suffix}` }),
  };
  const instance = brandValue(raw, "execution-policy") as ExecutionPolicyInstance;
  return {
    instance,
    setName: allowNameSetter
      ? (n: string) => {
          raw.name = n;
        }
      : undefined,
    setKey: allowKeySetter
      ? (k: string) => {
          raw.key = k;
        }
      : undefined,
  };
}

/**
 * Define a single workflow job function execution policy.
 *
 * Use this when declaring a policy outside the
 * {@link defineWorkflowExecutionPolicies} builder — for example, when the
 * runtime key prefix needs to differ from the corresponding workspace-unique
 * name.
 *
 * When `enableSuffix` is set, the returned instance has `forKey(suffix)`
 * instead of a directly-usable `key` (see {@link ExecutionPolicyWildcardInstance}).
 * @param name - Workspace-unique name. Must match `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`.
 * @param def - Optional overrides for `key` (defaults to `name`), `enableSuffix`, and concurrency
 * @returns An execution policy instance
 * @example
 * export const perTenant = defineWorkflowExecutionPolicy("tenant-api", {
 *   enableSuffix: true,
 *   concurrencyPolicy: { maxConcurrentExecutions: 3 },
 * });
 *
 * perTenant.forKey(tenantId); // "tenant-api.<tenantId>"
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineWorkflowExecutionPolicy<
  const N extends string,
  const D extends Omit<ExecutionPolicyDefInput, "name"> | undefined = undefined,
>(name: N, def?: D): ResolvedExecutionPolicyInstance<ResolveKey<D, N>, ResolveEnableSuffix<D>> {
  return createExecutionPolicyInstance(
    name,
    def?.key ?? name,
    def?.concurrencyPolicy,
    def?.enableSuffix ?? false,
    false,
    false,
  ).instance as ResolvedExecutionPolicyInstance<ResolveKey<D, N>, ResolveEnableSuffix<D>>;
}

/**
 * Define a group of workflow job function execution policies. Property names
 * become the workspace-unique `name` and default `key` verbatim, matching the
 * mental model of {@link defineWaitPoints}. Provide `name` / `key` explicitly
 * to override the property-name default (for example, when the property name
 * is not valid for the execution policy grammar or when the runtime key
 * prefix needs to differ).
 *
 * When `enableSuffix` is set, the returned instance has `forKey(suffix)`
 * instead of a directly-usable `key` (see {@link ExecutionPolicyWildcardInstance}).
 * `enableSuffix` can be combined with an explicit `key`, or left to apply to
 * the property-name-derived prefix.
 *
 * The return type mirrors the builder's return type so JSDoc on each property
 * is preserved in IDE autocompletion.
 * @param builder - Callback that receives a `define` factory and returns a record of policies
 * @returns The same object returned by the builder (with `name` / `key` resolved on each instance)
 * @example
 * export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
 *   premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
 *   "tenant-api": define({
 *     enableSuffix: true,
 *     concurrencyPolicy: { maxConcurrentExecutions: 3 },
 *   }),
 * }));
 *
 * // In a workflow job function:
 * await tailor.workflow.triggerJobFunction("worker", args, {
 *   executionPolicyKey: executionPolicies.premium.key,
 * });
 * await tailor.workflow.triggerJobFunction("worker", args, {
 *   executionPolicyKey: executionPolicies["tenant-api"].forKey(input.tenantId),
 * });
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineWorkflowExecutionPolicies<T extends Record<string, ExecutionPolicyInstance>>(
  builder: (
    define: <const D extends ExecutionPolicyDefInput | undefined = undefined>(
      def?: D,
    ) => ResolvedExecutionPolicyInstance<ResolveKey<D, string>, ResolveEnableSuffix<D>>,
  ) => T,
): T {
  const nameSetters = new Map<ExecutionPolicyInstance, (name: string) => void>();
  const keySetters = new Map<ExecutionPolicyInstance, (key: string) => void>();

  const define = <const D extends ExecutionPolicyDefInput | undefined = undefined>(
    def?: D,
  ): ResolvedExecutionPolicyInstance<ResolveKey<D, string>, ResolveEnableSuffix<D>> => {
    const explicitName = def?.name;
    const explicitKey = def?.key;
    const { instance, setName, setKey } = createExecutionPolicyInstance(
      explicitName ?? "__pending__",
      explicitKey ?? explicitName ?? "__pending__",
      def?.concurrencyPolicy,
      def?.enableSuffix ?? false,
      explicitName === undefined,
      explicitKey === undefined,
    );
    if (setName) nameSetters.set(instance, setName);
    if (setKey) keySetters.set(instance, setKey);
    return instance as ResolvedExecutionPolicyInstance<
      ResolveKey<D, string>,
      ResolveEnableSuffix<D>
    >;
  };

  const result = builder(define);

  for (const propName of Object.keys(result)) {
    const instance = result[propName] as ExecutionPolicyInstance;
    nameSetters.get(instance)?.(propName);
    keySetters.get(instance)?.(propName);
  }

  return result;
}
