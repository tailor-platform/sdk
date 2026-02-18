import type { Operation } from "./operation";
import type { Trigger } from "./trigger";
import type { AuthInvoker } from "@/configure/services/auth";
import type { Workflow } from "@/configure/services/workflow/workflow";
import type { ExecutorInput } from "@/parser/service/executor/types";

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
        authInvoker?: AuthInvoker<string>;
      };
    }
  : ExecutorBase<T> & {
      operation: O;
    };

/**
 * Create an executor configuration for the Tailor SDK.
 * @template T
 * @template O
 * @param config - Executor configuration
 * @returns The same executor configuration
 */
export function createExecutor<
  T extends Trigger<unknown>,
  O extends Operation<TriggerArgs<T>> | { kind: "workflow"; workflow: Workflow },
>(config: Executor<T, O>) {
  return config;
}
