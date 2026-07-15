/**
 * Workflow utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.workflow` runtime API.
 * At runtime this delegates to `globalThis.tailor.workflow`. Use `mockWorkflow`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 *
 * The canonical names (`startWorkflow`, `startJobFunction`,
 * `resumeWorkflowExecution`) mirror the public `tailor.v1` RPC vocabulary.
 * The pre-alignment names (`triggerWorkflow`, `triggerJobFunction`,
 * `resumeWorkflow`) are kept as frozen aliases that reference the same platform
 * implementations, so existing code continues to work unchanged.
 * @example
 * import { workflow } from "@tailor-platform/sdk/runtime";
 *
 * const executionId = await workflow.startWorkflow("myWorkflow", { data: "value" });
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Specifies the machine user that should be used to execute the workflow.
 * This allows workflows to run with specific authentication context.
 */
export interface Invoker {
  /** The namespace where the machine user is defined */
  namespace: string;
  /** The name of the machine user to use for workflow execution */
  machineUserName: string;
}

/** Options for {@link startWorkflow}. */
export interface StartWorkflowOptions {
  /** Optional authentication invoker to specify which machine user should execute the workflow */
  authInvoker?: Invoker;
}

/**
 * Options for the legacy {@link triggerWorkflow} alias, using the SDK-facing
 * `invoker` key that {@link triggerWorkflow} converts to `authInvoker` before
 * calling the platform.
 * @deprecated Use {@link startWorkflow} and {@link StartWorkflowOptions} instead.
 */
export interface TriggerWorkflowOptions {
  /** Optional invoker to specify which machine user should execute the workflow */
  invoker?: Invoker;
}

export interface PlatformTriggerWorkflowOptions {
  authInvoker?: Invoker;
}

declare const executionPolicyKeyBrand: unique symbol;

/**
 * A concrete runtime key produced by an execution policy instance — either an
 * exact-match policy's `.key`, or a wildcard policy's `.keyFor(suffix)` (see
 * `defineWorkflowExecutionPolicies`). Branded so an arbitrary string that
 * wasn't derived from a declared policy can't be passed as `executionPolicyKey`.
 */
export type ExecutionPolicyKey = string & { readonly [executionPolicyKeyBrand]: never };

/** Options for {@link startJobFunction}. */
export interface StartJobFunctionOptions {
  /**
   * Execution policy key matched by the platform against the policies
   * declared with `defineWorkflowExecutionPolicies` in `tailor.config.ts`.
   */
  executionPolicyKey?: ExecutionPolicyKey;
}

/**
 * Frozen alias for {@link StartJobFunctionOptions}. Kept for backward compatibility.
 * @deprecated Use {@link StartJobFunctionOptions} instead.
 */
export type TriggerJobFunctionOptions = StartJobFunctionOptions;

/**
 * Platform API surface for `tailor.workflow`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.workflow`.
 */
export interface PlatformWorkflowAPI {
  /**
   * Starts a workflow and returns its execution ID.
   *
   * Canonical name that mirrors the `tailor.v1` RPC vocabulary.
   * {@link triggerWorkflow} is a frozen alias that resolves to the same
   * platform implementation.
   * @param workflowName - Workflow name as defined in tailor.config
   * @param args - Arguments forwarded to the workflow's main job
   * @param options - Optional start options (e.g. `authInvoker`)
   * @returns The execution ID of the started workflow
   */
  startWorkflow(workflowName: string, args?: any, options?: StartWorkflowOptions): Promise<string>;

  /**
   * Frozen alias for {@link startWorkflow}. Kept for backward compatibility.
   * @deprecated Use {@link startWorkflow} instead.
   */
  triggerWorkflow(
    workflowName: string,
    args?: any,
    options?: PlatformTriggerWorkflowOptions,
  ): Promise<string>;

  /**
   * Resumes a failed or pending-retry workflow execution and returns its execution ID.
   *
   * Canonical name that mirrors the `tailor.v1` RPC vocabulary.
   * {@link resumeWorkflow} is a frozen alias that resolves to the same
   * platform implementation.
   * @param executionId - The execution to resume
   * @returns The execution ID of the resumed workflow
   */
  resumeWorkflowExecution(executionId: string): Promise<string>;

  /**
   * Frozen alias for {@link resumeWorkflowExecution}. Kept for backward compatibility.
   * @deprecated Use {@link resumeWorkflowExecution} instead.
   */
  resumeWorkflow(executionId: string): Promise<string>;

  /**
   * Starts a job function and returns its result.
   *
   * Canonical name that mirrors the `tailor.v1` RPC vocabulary.
   * {@link triggerJobFunction} is a frozen alias that resolves to the same
   * platform implementation.
   * @param jobName - Job name as defined in the workflow
   * @param args - Arguments forwarded to the job
   * @param options - Optional start options (e.g. `executionPolicyKey`)
   * @returns The job's return value
   */
  startJobFunction(jobName: string, args?: any, options?: StartJobFunctionOptions): any;

  /**
   * Frozen alias for {@link startJobFunction}. Kept for backward compatibility.
   * @deprecated Use {@link startJobFunction} instead.
   */
  triggerJobFunction(jobName: string, args?: any, options?: TriggerJobFunctionOptions): any;

  /**
   * Suspends the current workflow execution and waits for an external signal to resume.
   * @param key - Wait point key
   * @param payload - Optional payload to record with the wait point
   * @returns The payload supplied by the corresponding `resolve` call
   */
  wait(key: string, payload?: any): any;

  /**
   * Resolves a waiting workflow execution, causing it to resume.
   * @param executionId - The execution to resume
   * @param key - Wait point key to resolve
   * @param callback - Callback receiving the wait payload; its return value is forwarded to `wait`
   * @returns A promise that resolves once the resolve has been recorded
   */
  resolve(executionId: string, key: string, callback: (waitPayload: any) => any): Promise<void>;
}

/** Runtime wrapper API for workflow and job control. */
export interface TailorWorkflowAPI extends Omit<PlatformWorkflowAPI, "triggerWorkflow"> {
  /**
   * Triggers a workflow and returns its execution ID.
   * @param workflowName - Workflow name as defined in tailor.config
   * @param args - Arguments forwarded to the workflow's main job
   * @param options - Optional SDK trigger options
   * @returns The execution ID of the triggered workflow
   */
  triggerWorkflow(
    workflowName: string,
    args?: any,
    options?: TriggerWorkflowOptions,
  ): Promise<string>;
}

const api = (): PlatformWorkflowAPI =>
  (globalThis as unknown as { tailor: { workflow: PlatformWorkflowAPI } }).tailor.workflow;

/**
 * See {@link TailorWorkflowAPI.startWorkflow}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.startWorkflow}
 * @returns The execution ID of the started workflow
 */
const startWorkflow: PlatformWorkflowAPI["startWorkflow"] = (...args) =>
  api().startWorkflow(...args);

/**
 * Frozen alias for {@link startWorkflow}. Kept for backward compatibility.
 * Converts the SDK-facing `invoker` option to the platform's `authInvoker`.
 * @param workflowName - Workflow name as defined in tailor.config
 * @param args - Arguments forwarded to the workflow's main job
 * @param options - Optional SDK trigger options
 * @returns The execution ID of the triggered workflow
 * @deprecated Use {@link startWorkflow} instead.
 */
function triggerWorkflow(
  workflowName: string,
  args?: any,
  options?: TriggerWorkflowOptions,
): Promise<string> {
  if (options?.invoker === undefined) {
    return api().triggerWorkflow(workflowName, args);
  }
  return api().triggerWorkflow(workflowName, args, { authInvoker: options.invoker });
}

/**
 * See {@link TailorWorkflowAPI.resumeWorkflowExecution}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.resumeWorkflowExecution}
 * @returns The execution ID of the resumed workflow
 */
const resumeWorkflowExecution: PlatformWorkflowAPI["resumeWorkflowExecution"] = (...args) =>
  api().resumeWorkflowExecution(...args);

/**
 * Frozen alias for {@link resumeWorkflowExecution}. Kept for backward compatibility.
 * @param args - Forwarded to {@link resumeWorkflowExecution}
 * @returns The execution ID of the resumed workflow
 * @deprecated Use {@link resumeWorkflowExecution} instead.
 */
const resumeWorkflow: PlatformWorkflowAPI["resumeWorkflow"] = (...args) =>
  api().resumeWorkflow(...args);

/**
 * See {@link TailorWorkflowAPI.startJobFunction}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.startJobFunction}
 * @returns The job's return value
 */
const startJobFunction: PlatformWorkflowAPI["startJobFunction"] = (...args) =>
  api().startJobFunction(...args);

/**
 * Frozen alias for {@link startJobFunction}. Kept for backward compatibility.
 * @param args - Forwarded to {@link startJobFunction}
 * @returns The job's return value
 * @deprecated Use {@link startJobFunction} instead.
 */
const triggerJobFunction: PlatformWorkflowAPI["triggerJobFunction"] = (...args) =>
  api().triggerJobFunction(...args);

const wait: PlatformWorkflowAPI["wait"] = (...args) => api().wait(...args);

const resolve: PlatformWorkflowAPI["resolve"] = (...args) => api().resolve(...args);

/** Runtime wrapper namespace for `tailor.workflow`. */
export const workflow = {
  startWorkflow,
  triggerWorkflow,
  resumeWorkflowExecution,
  resumeWorkflow,
  startJobFunction,
  triggerJobFunction,
  wait,
  resolve,
} as const satisfies TailorWorkflowAPI;
