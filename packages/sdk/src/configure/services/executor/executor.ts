import type { Operation } from "./operation";
import type { Trigger } from "./trigger";
import type { AuthInvoker } from "@/configure/services/auth";
import type { Workflow } from "@/configure/services/workflow/workflow";
import type { ExecutorInput } from "@/parser/service/executor/types";

/**
 * Extract mainJob's Input type from Workflow.
 */
type WorkflowInput<W extends Workflow> = Parameters<W["trigger"]>[0];

type ExecutorBase<Args> = Omit<ExecutorInput, "trigger" | "operation"> & {
  trigger: Trigger<Args>;
};

/**
 * Executor type with conditional inference for workflow operations.
 * When operation.kind is "workflow", infers W from the workflow property
 * to ensure args type matches the workflow's mainJob input type.
 */
type Executor<Args, O> = O extends {
  kind: "workflow";
  workflow: infer W extends Workflow;
}
  ? ExecutorBase<Args> & {
      operation: {
        kind: "workflow";
        workflow: W;
        args?: WorkflowInput<W> | ((args: Args) => WorkflowInput<W>);
        authInvoker?: AuthInvoker<string>;
      };
    }
  : ExecutorBase<Args> & {
      operation: O;
    };

export function createExecutor<
  Args,
  O extends Operation<Args> | { kind: "workflow"; workflow: Workflow },
>(config: Executor<Args, O>) {
  return config;
}
