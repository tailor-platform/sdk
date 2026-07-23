// Default `tailor.workflow` runner installed by the `tailor-runtime` environment.
// Must stay free of `vitest` (`vi`): it loads via `./globals` in the environment
// realm where `vi` is unavailable, hence relative imports only (no `@/` alias).
import { runRegisteredJob, runRegisteredWorkflow } from "../configure/services/workflow/registry";
import type { ExecJobFunctionOptions, StartWorkflowOptions } from "../runtime/workflow";

export interface DefaultWorkflowRuntime {
  execJobFunction: (name: string, args?: unknown, options?: ExecJobFunctionOptions) => unknown;
  startJobFunction: (name: string, args?: unknown, options?: ExecJobFunctionOptions) => unknown;
  triggerJobFunction: (name: string, args?: unknown, options?: ExecJobFunctionOptions) => unknown;
  startWorkflow: (name: string, args?: unknown, options?: StartWorkflowOptions) => Promise<string>;
  triggerWorkflow: (
    name: string,
    args?: unknown,
    options?: StartWorkflowOptions,
  ) => Promise<string>;
  resumeWorkflowExecution: (executionId: string) => Promise<string>;
  resumeWorkflow: (executionId: string) => Promise<string>;
  wait: (key: string, payload?: unknown) => unknown;
  resolve: (
    executionId: string,
    key: string,
    callback: (payload: unknown) => unknown,
  ) => Promise<void>;
}

export function createDefaultWorkflowRuntime(): DefaultWorkflowRuntime {
  const execJobFunction: DefaultWorkflowRuntime["execJobFunction"] = (name, args) =>
    runRegisteredJob(name, args);
  const startWorkflow: DefaultWorkflowRuntime["startWorkflow"] = (name, args) =>
    runRegisteredWorkflow(name, args);
  const resumeWorkflowExecution: DefaultWorkflowRuntime["resumeWorkflowExecution"] = async (
    executionId,
  ) => executionId;
  return {
    execJobFunction,
    startJobFunction: execJobFunction,
    triggerJobFunction: execJobFunction,
    startWorkflow,
    triggerWorkflow: startWorkflow,
    resumeWorkflowExecution,
    resumeWorkflow: resumeWorkflowExecution,
    wait: (key: string): unknown => {
      throw new Error(
        `No wait handler for "${key}". Acquire mockWorkflow() and call setWaitHandler(...).`,
      );
    },
    resolve: async (): Promise<void> => {
      throw new Error(
        "No resolve handler. Acquire mockWorkflow() and call setResolveHandler(...).",
      );
    },
  };
}
