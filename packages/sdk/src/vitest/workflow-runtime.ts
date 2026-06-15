// Default `tailor.workflow` runner installed by the `tailor-runtime` environment.
// Must stay free of `vitest` (`vi`): it loads via `./globals` in the environment
// realm where `vi` is unavailable, hence relative imports only (no `@/` alias).
import { TRIGGER_DEFAULT } from "../configure/services/workflow/registry";

export interface DefaultWorkflowRuntime {
  triggerJobFunction: (name: string, args?: unknown) => unknown;
  triggerWorkflow: (name: string, args?: unknown, options?: unknown) => Promise<string>;
  wait: (key: string, payload?: unknown) => unknown;
  resolve: (
    executionId: string,
    key: string,
    callback: (payload: unknown) => unknown,
  ) => Promise<void>;
}

export function createDefaultWorkflowRuntime(): DefaultWorkflowRuntime {
  return {
    triggerJobFunction: (name) => {
      throw new Error(
        `No workflow job mock for "${name}". Acquire mockWorkflow() and call setJobHandler(...) or enqueueResult(...), or use runWorkflowLocally() for local workflow execution.`,
      );
    },
    triggerWorkflow: async () => TRIGGER_DEFAULT,
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
