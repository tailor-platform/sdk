import type {
  FunctionOperation,
  GqlOperation,
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
 * Executor configuration with type-safe operation inference.
 * Uses union discrimination by `kind` to enable:
 * - `const Q`: preserves GraphQL query literal type for variable inference
 * - `V`: infers variables return type for strict excess property checking
 * - `W`: infers workflow type for args type safety
 */
type ExecutorConfig<
  T extends Trigger<unknown>,
  Q extends string = string,
  V = ResolvedGqlVariables<Q>,
  W extends Workflow = Workflow,
> = ExecutorBase<T> & {
  operation:
    | WorkflowOperation<TriggerArgs<T>, W>
    | GqlOperation<TriggerArgs<T>, Q, V>
    | FunctionOperation<TriggerArgs<T>>
    | WebhookOperation<TriggerArgs<T>>;
};

/**
 * Create an executor configuration for the Tailor SDK.
 * Uses `const Q` to preserve the literal type of GraphQL query strings,
 * enabling type-safe variable inference via `GeneratedGqlSchema`.
 * @template T - Trigger type
 * @template Q - GraphQL query literal type (narrowed with `const`)
 * @template V - Variables return type (inferred for strict excess checking)
 * @template W - Workflow type for args inference
 * @param config - Executor configuration
 * @returns The same executor configuration
 */
export function createExecutor<
  T extends Trigger<unknown>,
  const Q extends string = string,
  V extends ResolvedGqlVariables<Q> = ResolvedGqlVariables<Q>,
  W extends Workflow = Workflow,
>(config: ExecutorConfig<T, Q, V, W>): ExecutorConfig<T, Q, V, W>;

export function createExecutor<
  T extends Trigger<unknown>,
  Q extends string = string,
  V = ResolvedGqlVariables<Q>,
  W extends Workflow = Workflow,
>(config: ExecutorConfig<T, Q, V, W>) {
  return config;
}
