// Default `tailor.workflow` runner installed by the `tailor-runtime` environment.
// Must stay free of `vitest` (`vi`): it loads via `./globals` in the environment
// realm where `vi` is unavailable, hence relative imports only (no `@/` alias).
import { START_DEFAULT } from "../configure/services/workflow/registry";
import { platformSerialize } from "../utils/test/platform-serialize";
import type { ExecJobFunctionOptions, StartWorkflowOptions } from "../runtime/workflow";

export interface DefaultWorkflowRuntime {
  execJobFunction: (name: string, args?: unknown, options?: ExecJobFunctionOptions) => unknown;
  startWorkflow: (name: string, args?: unknown, options?: StartWorkflowOptions) => Promise<string>;
  resumeWorkflowExecution: (executionId: string) => Promise<string>;
  wait: (key: string, payload?: unknown) => unknown;
  resolve: (
    executionId: string,
    key: string,
    callback: (payload: unknown) => unknown,
  ) => Promise<void>;
}

export function createDefaultWorkflowRuntime(): DefaultWorkflowRuntime {
  const execJobFunction: DefaultWorkflowRuntime["execJobFunction"] = (name) => {
    throw new Error(
      `No workflow job mock for "${name}". Acquire mockWorkflow() and call setJobHandler(...) or enqueueResult(...), or use runWorkflowLocally() for local workflow execution.`,
    );
  };
  const startWorkflow: DefaultWorkflowRuntime["startWorkflow"] = async (_name, args) => {
    platformSerialize(args);
    return START_DEFAULT;
  };
  const resumeWorkflowExecution: DefaultWorkflowRuntime["resumeWorkflowExecution"] = async (
    executionId,
  ) => executionId;
  return {
    execJobFunction,
    startWorkflow,
    resumeWorkflowExecution,
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
