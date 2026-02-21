import type {
  FunctionOperation,
  GqlOperation,
  Operation,
  WebhookOperation,
  WorkflowOperation,
} from "./operation";
import type { Trigger } from "./trigger";
import type { Workflow } from "@/configure/services/workflow/workflow";
import type { ResolvedGqlVariables } from "@/graphql/infer";
import type { ExecutorInput } from "@/parser/service/executor/types";

type TriggerArgs<T extends Trigger<unknown>> = T extends { __args: infer Args } ? Args : never;

type ExecutorBase<T extends Trigger<unknown>> = Omit<ExecutorInput, "trigger" | "operation"> & {
  trigger: T;
};

/**
 * Narrow the return type of `createExecutor` based on the operation `kind`.
 * Uses `[Kind] extends [...]` (tuple wrapping) to prevent distributive behavior.
 */
type ExecutorReturn<
  T extends Trigger<unknown>,
  Kind extends string,
  Q extends string,
  V,
  W extends Workflow,
> = [Kind] extends ["workflow"]
  ? ExecutorBase<T> & { operation: WorkflowOperation<TriggerArgs<T>, W> }
  : [Kind] extends ["graphql"]
    ? ExecutorBase<T> & { operation: GqlOperation<TriggerArgs<T>, Q, V> }
    : [Kind] extends ["function" | "jobFunction"]
      ? ExecutorBase<T> & { operation: FunctionOperation<TriggerArgs<T>> }
      : [Kind] extends ["webhook"]
        ? ExecutorBase<T> & { operation: WebhookOperation<TriggerArgs<T>> }
        : ExecutorBase<T> & { operation: Operation<TriggerArgs<T>, Q, V> };

/**
 * Create an executor configuration for the Tailor SDK.
 *
 * Uses `const Q` to preserve the literal type of GraphQL query strings,
 * enabling type-safe variable inference via `GeneratedGqlSchema`.
 * The return type is narrowed based on the operation `kind` discriminant.
 * @param config - Executor configuration
 * @returns The same executor configuration with narrowed operation type
 */
export function createExecutor<
  T extends Trigger<unknown>,
  const Q extends string = string,
  V extends ResolvedGqlVariables<Q> = ResolvedGqlVariables<Q>,
  W extends Workflow = Workflow,
  const Kind extends string = string,
>(
  config: ExecutorBase<T> & {
    operation: { kind: Kind } & (
      | WorkflowOperation<TriggerArgs<T>, W>
      | GqlOperation<TriggerArgs<T>, Q, V>
      | (Omit<GqlOperation<TriggerArgs<T>, Q, V>, "query"> & {
          // Escape hatch for DocumentNode-like objects (toString() produces the query string).
          // Does not participate in type-safe variable inference.
          query: object & { toString(): string };
        })
      | FunctionOperation<TriggerArgs<T>>
      | WebhookOperation<TriggerArgs<T>>
    );
  },
): ExecutorReturn<T, Kind, Q, V, W>;

export function createExecutor(config: unknown) {
  return config;
}
