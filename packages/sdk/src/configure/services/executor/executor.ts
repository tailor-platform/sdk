import { brandValue } from "@/utils/brand";
import type { Operation } from "./operation";
import type { Trigger } from "./trigger";
import type { Workflow } from "@/configure/services/workflow/workflow";
import type { MachineUserName } from "@/configure/types/machine-user";
import type { ExecutorInput } from "@/types/executor.generated";

/**
 * Extract mainJob's Input type from Workflow.
 */
type WorkflowInput<W extends Workflow> = Parameters<W["trigger"]>[0];

type TriggerArgs<T extends Trigger<unknown>> = T extends { __args: infer Args } ? Args : never;

type ExecutorBase<T extends Trigger<unknown>> = Omit<ExecutorInput, "trigger" | "operation"> & {
  trigger: T;
};

/**
 * Executor type with conditional inference for workflow operations.
 * When operation.kind is "workflow", infers W from the workflow property
 * to ensure args type matches the workflow's mainJob input type.
 */
type Executor<T extends Trigger<unknown>, O> = O extends {
  kind: "workflow";
  workflow: infer W extends Workflow;
}
  ? ExecutorBase<T> & {
      operation: {
        kind: "workflow";
        workflow: W;
        args?: WorkflowInput<W> | ((args: TriggerArgs<T>) => WorkflowInput<W>);
        invoker?: MachineUserName;
      };
    }
  : ExecutorBase<T> & {
      operation: O;
    };

/**
 * Create an executor configuration for the Tailor SDK.
 *
 * Executors are event-driven handlers that respond to record changes,
 * resolver executions, or other events.
 *
 * Operation kinds: "function", "graphql", "webhook", "workflow".
 * @template T
 * @template O
 * @param config - Executor configuration
 * @returns The same executor configuration
 * @example
 * import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
 * import { order } from "../tailordb/order";
 *
 * export default createExecutor({
 *   name: "order-created",
 *   description: "Handles new order creation",
 *   trigger: recordCreatedTrigger({ type: order }),
 *   operation: {
 *     kind: "function",
 *     body: async ({ newRecord }) => {
 *       console.log("New order:", newRecord.id);
 *     },
 *   },
 * });
 */
export function createExecutor<
  T extends Trigger<unknown>,
  O extends Operation<TriggerArgs<T>> | { kind: "workflow"; workflow: Workflow },
>(config: Executor<T, O>): Executor<T, O>;

/**
 * Create an executor configuration for the Tailor SDK.
 * This overload preserves source compatibility for legacy explicit generic calls,
 * where the first generic argument represents trigger args.
 * @template Args
 * @template O
 * @param config - Executor configuration
 * @returns The same executor configuration
 */
export function createExecutor<
  Args,
  O extends Operation<Args> | { kind: "workflow"; workflow: Workflow },
>(config: Executor<Trigger<Args>, O>): Executor<Trigger<Args>, O>;

/* @__NO_SIDE_EFFECTS__ */
export function createExecutor<
  T extends Trigger<unknown>,
  O extends Operation<TriggerArgs<T>> | { kind: "workflow"; workflow: Workflow },
>(config: Executor<T, O>) {
  return brandValue(config, "executor");
}
