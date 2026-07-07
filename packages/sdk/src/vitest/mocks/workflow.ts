import { vi } from "vitest";
import {
  getRegisteredJob,
  getRegisteredWorkflow,
  TRIGGER_DEFAULT,
} from "#/configure/services/workflow/registry";
import { platformSerialize } from "#/utils/test/platform-serialize";
import {
  buildJobContext,
  clearWorkflowTestEnv,
  writeWorkflowTestEnv,
} from "../../configure/services/workflow/test-env-key";
import { tailorRoot, withDispose } from "./shared";
import type { TailorEnv } from "../../runtime/types";

type JobHandler = (jobName: string, args: unknown, options?: TriggerJobFunctionOptions) => unknown;

type TriggerWorkflowOptions = {
  authInvoker?: { namespace: string; machineUserName: string };
};
type TriggerJobFunctionOptions = {
  executionPolicyKey?: string;
};
type TriggerHandlerFn = (
  workflowName: string,
  args: unknown,
  options?: TriggerWorkflowOptions,
) => string;
type ResumeHandlerFn = (executionId: string) => string;
type WaitHandlerFn = (key: string, payload: unknown) => unknown;
type ResolveHandler = (
  executionId: string,
  key: string,
  callback: (payload: unknown) => unknown,
) => unknown | Promise<unknown>;

// Overloaded so TypeScript narrows to WaitHandlerFn first (giving inferred
// `(key: string, payload: unknown) => …` for callers) before falling back
// to the static-value form. A union type would let `unknown` swallow the
// function variant and break inference.
type SetWaitHandler = {
  (handler: WaitHandlerFn): void;
  (handler: unknown): void;
};

interface TriggeredJob {
  jobName: string;
  args: unknown;
  options?: TriggerJobFunctionOptions;
}

// ---------------------------------------------------------------------------
// Workflow Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for workflow operations (`tailor.workflow`).
 * Restored on dispose.
 * @returns Disposable workflow mock control object
 * @example
 * ```typescript
 * import { mockWorkflow } from "@tailor-platform/sdk/vitest";
 *
 * test("job handler", async () => {
 *   using wf = mockWorkflow();
 *   wf.setJobHandler((name) => (name === "validate" ? { valid: true } : null));
 *   await runWorkflowUnderTest(); // calls tailor.workflow.triggerJobFunction("validate", {})
 *   expect(wf.triggerJobFunction).toHaveBeenCalledWith("validate", {});
 * });
 * ```
 */
export function mockWorkflow() {
  const root = tailorRoot();
  const prev = root.workflow;

  // Default impls (also restored by reset): run the registered body by name so a
  // `.trigger()` with no handler/result executes the real job locally.
  const defaultTriggerJob = (
    jobName: string,
    args?: unknown,
    _options?: TriggerJobFunctionOptions,
  ): unknown => {
    const body = getRegisteredJob(jobName);
    return body ? body(args, buildJobContext()) : null;
  };
  const defaultTriggerWorkflow = async (
    workflowName: string,
    args?: unknown,
    _options?: TriggerWorkflowOptions,
  ): Promise<string> => {
    const wf = getRegisteredWorkflow(workflowName);
    if (wf) {
      const out = triggerJobFunction(wf.mainJobName, platformSerialize(args));
      if (out instanceof Promise) await out;
    }
    return TRIGGER_DEFAULT;
  };
  const defaultResumeWorkflow = async (executionId: string): Promise<string> => executionId;

  // Inner vi.fns hold the overridable behavior + call recording; the installed
  // shims below cross the platform JSON boundary (serialize args + results) once
  // so every path (default body, setJobHandler, enqueueResult) is covered.
  const triggerJobFunction = vi.fn(defaultTriggerJob);
  const triggerWorkflow = vi.fn(defaultTriggerWorkflow);
  const resumeWorkflow = vi.fn(defaultResumeWorkflow);
  const wait = vi.fn((_key: string, _payload?: unknown): unknown => null);
  const resolve = vi.fn(
    async (
      _executionId: string,
      _key: string,
      _callback: (payload: unknown) => unknown,
    ): Promise<void> => {},
  );

  root.workflow = {
    // Preserve arity: recording `undefined` as the third element only when the
    // caller supplied it, mirroring `.triggerJobFunction(name, args, options)`.
    triggerJobFunction: (...call: [string, unknown?, TriggerJobFunctionOptions?]) => {
      const out =
        call.length >= 3
          ? triggerJobFunction(call[0], platformSerialize(call[1]), call[2])
          : triggerJobFunction(call[0], platformSerialize(call[1]));
      return out instanceof Promise
        ? out.then((v) => platformSerialize(v))
        : platformSerialize(out);
    },
    // Preserve arity so a forwarded third `options` arg — even `undefined` — is
    // recorded, matching the real `.trigger(args, options)` call shape.
    triggerWorkflow: (...call: [string, unknown?, TriggerWorkflowOptions?]) =>
      call.length >= 3
        ? triggerWorkflow(call[0], platformSerialize(call[1]), call[2])
        : triggerWorkflow(call[0], platformSerialize(call[1])),
    resumeWorkflow: (executionId: string) => resumeWorkflow(executionId),
    wait: (key: string, payload?: unknown) => wait(key, platformSerialize(payload)),
    resolve: (executionId: string, key: string, callback: (payload: unknown) => unknown) =>
      resolve(executionId, key, (payload: unknown) => {
        const out = callback(payload);
        return out instanceof Promise
          ? out.then((v) => platformSerialize(v))
          : platformSerialize(out);
      }),
  };

  const facade = {
    /** The `triggerJobFunction` `vi.fn`. */
    triggerJobFunction,
    /** The `triggerWorkflow` `vi.fn`. */
    triggerWorkflow,
    /** The `resumeWorkflow` `vi.fn`. */
    resumeWorkflow,
    /** The `wait` `vi.fn`. */
    wait,
    /** The `resolve` `vi.fn`. */
    resolve,

    /**
     * Set a fallback job handler. Called when the enqueue queue is empty.
     * @param handler - Function returning a result for a job name, args, and options
     */
    setJobHandler(handler: JobHandler): void {
      triggerJobFunction.mockImplementation((name, args, options) => handler(name, args, options));
    },

    /**
     * Enqueue a single result for the next `triggerJobFunction` call (FIFO;
     * takes priority over `setJobHandler`).
     * @param result - Result to return from the next call
     */
    enqueueResult(result: unknown): void {
      triggerJobFunction.mockImplementationOnce(() => result);
    },

    /**
     * Enqueue results for multiple subsequent `triggerJobFunction` calls (FIFO).
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      for (const result of results) {
        triggerJobFunction.mockImplementationOnce(() => result);
      }
    },

    /**
     * All jobs triggered via `triggerJobFunction`, in order.
     * @returns Triggered jobs array
     */
    get triggeredJobs(): TriggeredJob[] {
      return triggerJobFunction.mock.calls.map(([jobName, args, options]) => ({
        jobName: jobName as string,
        args,
        ...(options !== undefined && { options: options as TriggerJobFunctionOptions }),
      }));
    },

    /**
     * Configure what `triggerWorkflow` returns. Pass a string (same id every
     * call) or `(name, args, options) => string`. Default: a placeholder UUID.
     * @param handler - Static execution ID or a function returning one
     */
    setTriggerHandler(handler: string | TriggerHandlerFn): void {
      triggerWorkflow.mockImplementation(
        typeof handler === "function"
          ? async (name, args, options) => handler(name, args, options)
          : async () => handler,
      );
    },

    /**
     * Configure what `resumeWorkflow` returns. Pass a string (same id every
     * call) or `(executionId) => string`. Default: echoes the input executionId.
     * @param handler - Static execution ID or a function returning one
     */
    setResumeHandler(handler: string | ResumeHandlerFn): void {
      resumeWorkflow.mockImplementation(
        typeof handler === "function"
          ? async (executionId) => handler(executionId)
          : async () => handler,
      );
    },

    /**
     * Configure what `wait` returns. Pass `(key, payload) => unknown` or any
     * other value to return it for every call. Default: `null`.
     * @param handler - Static value or a function returning one
     */
    setWaitHandler: ((handler: unknown) => {
      wait.mockImplementation(
        typeof handler === "function"
          ? (key, payload) => (handler as WaitHandlerFn)(key, payload)
          : () => handler,
      );
    }) as SetWaitHandler,

    /**
     * Set the `env` passed to job bodies invoked via `createWorkflowJob().trigger()`.
     * Cleared on dispose / reset.
     * @param env - Env passed to job bodies.
     */
    setEnv(env: TailorEnv): void {
      writeWorkflowTestEnv({ ...env });
    },

    /**
     * Configure how `resolve` runs the user-supplied callback. Default: callback
     * is not invoked (records the call only).
     * @param handler - Function invoked per `resolve` call
     */
    setResolveHandler(handler: ResolveHandler): void {
      resolve.mockImplementation(async (executionId, key, callback) => {
        await handler(executionId, key, callback);
      });
    },

    /**
     * `wait` calls reshaped as `{ key, payload }` for assertions.
     * @returns Wait call records
     */
    get waitCalls(): { key: string; payload: unknown }[] {
      return wait.mock.calls.map(([key, payload]) => ({ key: key as string, payload }));
    },

    /**
     * `resolve` calls reshaped as `{ executionId, key }` for assertions.
     * @returns Resolve call records
     */
    get resolveCalls(): { executionId: string; key: string }[] {
      return resolve.mock.calls.map(([executionId, key]) => ({
        executionId: executionId as string,
        key: key as string,
      }));
    },

    /** Reset all workflow responses and recorded calls (keeps the mock installed). */
    reset(): void {
      triggerJobFunction.mockReset();
      triggerJobFunction.mockImplementation(defaultTriggerJob);
      triggerWorkflow.mockReset();
      triggerWorkflow.mockImplementation(defaultTriggerWorkflow);
      resumeWorkflow.mockReset();
      resumeWorkflow.mockImplementation(defaultResumeWorkflow);
      wait.mockReset();
      wait.mockImplementation(() => null);
      resolve.mockReset();
      resolve.mockImplementation(async () => {});
      clearWorkflowTestEnv();
    },
  };

  return withDispose(facade, () => {
    root.workflow = prev;
    clearWorkflowTestEnv();
  });
}
