import { brandValue } from "#/utils/brand";
import type {
  ExecutionPolicyConcurrency,
  ExecutionPolicyDefInput,
  ExecutionPolicyInstance,
} from "./execution-policy.types";

export type {
  ExecutionPolicyConcurrency,
  ExecutionPolicyDefInput,
  ExecutionPolicyInstance,
} from "./execution-policy.types";

interface ExecutionPolicyWithSetters {
  instance: ExecutionPolicyInstance;
  setName: ((name: string) => void) | undefined;
  setKey: ((key: string) => void) | undefined;
}

// camelCase → kebab-case with acronym-aware boundaries. Splits at every
// lower-to-upper transition and at the tail of an uppercase run when the next
// letter starts a new lowercase word, so `tenantAPIJob` yields
// `tenant-api-job` instead of `tenant-apijob`. Already-kebab-case identifiers
// pass through unchanged.
function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function createExecutionPolicyInstance(
  initialName: string,
  initialKey: string,
  concurrencyPolicy: ExecutionPolicyConcurrency | undefined,
  allowNameSetter: boolean,
  allowKeySetter: boolean,
): ExecutionPolicyWithSetters {
  const raw: { name: string; key: string; concurrencyPolicy?: ExecutionPolicyConcurrency } = {
    name: initialName,
    key: initialKey,
    ...(concurrencyPolicy && { concurrencyPolicy }),
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
 * runtime key contains `:`, `.`, or a trailing `*` and the corresponding TRN
 * name is worth spelling out by hand.
 * @param name - TRN-embedded name. Must match `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`.
 * @param def - Optional overrides for `key` (defaults to `name`) and concurrency
 * @returns An execution policy instance
 * @example
 * export const perTenant = defineWorkflowExecutionPolicy("per-tenant", {
 *   key: "tenant-api*",
 *   concurrencyPolicy: { maxConcurrentExecutions: 3 },
 * });
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineWorkflowExecutionPolicy(
  name: string,
  def?: Omit<ExecutionPolicyDefInput, "name">,
): ExecutionPolicyInstance {
  return createExecutionPolicyInstance(name, def?.key ?? name, def?.concurrencyPolicy, false, false)
    .instance;
}

/**
 * Define a group of workflow job function execution policies. Property names
 * become the TRN `name` (camelCase → kebab-case) and default `key` unless
 * overridden via `name` / `key` in the body.
 *
 * The return type mirrors the builder's return type so JSDoc on each property
 * is preserved in IDE autocompletion.
 * @param builder - Callback that receives a `define` factory and returns a record of policies
 * @returns The same object returned by the builder (with `name` / `key` resolved on each instance)
 * @example
 * export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
 *   premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
 *   tenantApi: define({
 *     key: "tenant-api*",
 *     concurrencyPolicy: { maxConcurrentExecutions: 3 },
 *   }),
 * }));
 *
 * // In a workflow job function:
 * await tailor.workflow.triggerJobFunction("worker", args, {
 *   executionPolicyKey: executionPolicies.premium.key,
 * });
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineWorkflowExecutionPolicies<T extends Record<string, ExecutionPolicyInstance>>(
  builder: (define: (def?: ExecutionPolicyDefInput) => ExecutionPolicyInstance) => T,
): T {
  const nameSetters = new Map<ExecutionPolicyInstance, (name: string) => void>();
  const keySetters = new Map<ExecutionPolicyInstance, (key: string) => void>();

  const define = (def?: ExecutionPolicyDefInput): ExecutionPolicyInstance => {
    const explicitName = def?.name;
    const explicitKey = def?.key;
    const { instance, setName, setKey } = createExecutionPolicyInstance(
      explicitName ?? "__pending__",
      explicitKey ?? explicitName ?? "__pending__",
      def?.concurrencyPolicy,
      explicitName === undefined,
      explicitKey === undefined,
    );
    if (setName) nameSetters.set(instance, setName);
    if (setKey) keySetters.set(instance, setKey);
    return instance;
  };

  const result = builder(define);

  for (const propName of Object.keys(result)) {
    const instance = result[propName] as ExecutionPolicyInstance;
    const derived = camelToKebab(propName);
    nameSetters.get(instance)?.(derived);
    keySetters.get(instance)?.(derived);
  }

  return result;
}
