// Default `tailor.workflow` runner installed by the `tailor-runtime` environment
// so `.trigger()` runs the real job bodies of a workflow chain locally without
// acquiring `mockWorkflow()`. `mockWorkflow()` overlays this with vi.fn-backed
// recording/override and restores it on dispose.
//
// Kept free of any `vitest` (`vi`) dependency: it is imported from `./globals`,
// which loads in the Vitest *environment* realm where `vi` is unavailable. Only
// relative imports (no `@/` alias) so nested Vitest configs resolve it.
//
// Trigger args and results cross the same JSON boundary the platform uses, so a
// non-serializable payload fails the test exactly as it would in production.
import { getRegisteredJob, getRegisteredWorkflow } from "../configure/services/workflow/registry";
import { buildJobContext } from "../configure/services/workflow/test-env-key";
import { platformSerialize } from "../utils/test/platform-serialize";

const TRIGGER_DEFAULT = "mock-execution-id";

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

function serializeReturn(out: unknown): unknown {
  return out instanceof Promise ? out.then((v) => platformSerialize(v)) : platformSerialize(out);
}

/**
 * Build the default runner. `triggerJobFunction` runs the registered body by
 * name; `triggerWorkflow` runs the workflow's main job and returns a stub
 * execution id. `wait` / `resolve` have no local default and direct the caller
 * to `mockWorkflow()`.
 * @returns The default `tailor.workflow` implementation.
 */
export function createDefaultWorkflowRuntime(): DefaultWorkflowRuntime {
  const triggerJobFunction = (name: string, args?: unknown): unknown => {
    const body = getRegisteredJob(name);
    const out = body ? body(platformSerialize(args), buildJobContext()) : null;
    return serializeReturn(out);
  };

  const triggerWorkflow = async (name: string, args?: unknown): Promise<string> => {
    const workflow = getRegisteredWorkflow(name);
    if (workflow) await triggerJobFunction(workflow.mainJobName, args);
    return TRIGGER_DEFAULT;
  };

  const wait = (key: string): unknown => {
    throw new Error(
      `No wait handler for "${key}". Acquire mockWorkflow() and call setWaitHandler(...).`,
    );
  };

  const resolve = async (): Promise<void> => {
    throw new Error("No resolve handler. Acquire mockWorkflow() and call setResolveHandler(...).");
  };

  return { triggerJobFunction, triggerWorkflow, wait, resolve };
}
