/**
 * Workflow utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.workflow` runtime API.
 * At runtime this delegates to `globalThis.tailor.workflow`. Use `mockWorkflow`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 *
 * The canonical names (`startWorkflow`, `execJobFunction`,
 * `resumeWorkflowExecution`) mirror the public `tailor.v1` RPC vocabulary.
 * The pre-alignment names (`triggerWorkflow`, `triggerJobFunction`,
 * `startJobFunction`, `resumeWorkflow`) are kept as aliases that reference
 * the same platform implementations, so existing code continues to work
 * unchanged.
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
export interface AuthInvoker {
  /** The namespace where the machine user is defined */
  namespace: string;
  /** The name of the machine user to use for workflow execution */
  machineUserName: string;
}

/** Options for {@link startWorkflow}. */
export interface StartWorkflowOptions {
  /** Optional authentication invoker to specify which machine user should execute the workflow */
  authInvoker?: AuthInvoker;
}

/**
 * Frozen alias for {@link StartWorkflowOptions}. Kept for backward compatibility.
 * @deprecated Use {@link StartWorkflowOptions} instead.
 */
export type TriggerWorkflowOptions = StartWorkflowOptions;

declare const executionPolicyKeyBrand: unique symbol;

/**
 * A concrete runtime key produced by an execution policy instance — either an
 * exact-match policy's `.key`, or a wildcard policy's `.keyFor(suffix)` (see
 * `defineWorkflowExecutionPolicies`). Branded so an arbitrary string that
 * wasn't derived from a declared policy can't be passed as `executionPolicyKey`.
 */
export type ExecutionPolicyKey = string & { readonly [executionPolicyKeyBrand]: never };

/** Options for {@link execJobFunction}. */
export interface ExecJobFunctionOptions {
  /**
   * Execution policy key matched by the platform against the policies
   * declared with `defineWorkflowExecutionPolicies` in `tailor.config.ts`.
   */
  executionPolicyKey?: ExecutionPolicyKey;
}

/**
 * Alias for {@link ExecJobFunctionOptions}. Kept for backward compatibility.
 * @deprecated Use {@link ExecJobFunctionOptions} instead.
 */
export type StartJobFunctionOptions = ExecJobFunctionOptions;

/**
 * Frozen alias for {@link ExecJobFunctionOptions}. Kept for backward compatibility.
 * @deprecated Use {@link ExecJobFunctionOptions} instead.
 */
export type TriggerJobFunctionOptions = ExecJobFunctionOptions;

/**
 * Platform API surface for `tailor.workflow`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.workflow`.
 *
 * Each method below is also re-exported as a top-level named export from this
 * module so callers can either `import * as workflow from
 * "@tailor-platform/sdk/runtime/workflow"` or pick individual methods.
 */
export interface TailorWorkflowAPI {
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
    options?: TriggerWorkflowOptions,
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
   * Executes a job function and returns its result.
   *
   * Canonical name that mirrors the `tailor.v1` RPC vocabulary.
   * {@link startJobFunction} and {@link triggerJobFunction} are aliases that
   * resolve to the same platform implementation.
   * @param jobName - Job name as defined in the workflow
   * @param args - Arguments forwarded to the job
   * @param options - Optional exec options (e.g. `executionPolicyKey`)
   * @returns The job's return value
   */
  execJobFunction(jobName: string, args?: any, options?: ExecJobFunctionOptions): any;

  /**
   * Alias for {@link execJobFunction}. Kept for backward compatibility.
   * @deprecated Use {@link execJobFunction} instead.
   */
  startJobFunction(jobName: string, args?: any, options?: StartJobFunctionOptions): any;

  /**
   * Frozen alias for {@link execJobFunction}. Kept for backward compatibility.
   * @deprecated Use {@link execJobFunction} instead.
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

const api = (): TailorWorkflowAPI =>
  (globalThis as { tailor: { workflow: TailorWorkflowAPI } }).tailor.workflow;

/**
 * See {@link TailorWorkflowAPI.startWorkflow}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.startWorkflow}
 * @returns The execution ID of the started workflow
 */
export const startWorkflow: TailorWorkflowAPI["startWorkflow"] = (...args) =>
  api().startWorkflow(...args);

/**
 * Frozen alias for {@link startWorkflow}. Kept for backward compatibility.
 * @deprecated Use {@link startWorkflow} instead.
 * @param args - Forwarded to {@link TailorWorkflowAPI.triggerWorkflow}
 * @returns The execution ID of the triggered workflow
 */
export const triggerWorkflow: TailorWorkflowAPI["triggerWorkflow"] = (...args) =>
  api().triggerWorkflow(...args);

/**
 * See {@link TailorWorkflowAPI.resumeWorkflowExecution}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.resumeWorkflowExecution}
 * @returns The execution ID of the resumed workflow
 */
export const resumeWorkflowExecution: TailorWorkflowAPI["resumeWorkflowExecution"] = (...args) =>
  api().resumeWorkflowExecution(...args);

/**
 * Frozen alias for {@link resumeWorkflowExecution}. Kept for backward compatibility.
 * @deprecated Use {@link resumeWorkflowExecution} instead.
 * @param args - Forwarded to {@link TailorWorkflowAPI.resumeWorkflow}
 * @returns The execution ID of the resumed workflow
 */
export const resumeWorkflow: TailorWorkflowAPI["resumeWorkflow"] = (...args) =>
  api().resumeWorkflow(...args);

/**
 * See {@link TailorWorkflowAPI.execJobFunction}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.execJobFunction}
 * @returns The job's return value
 */
export const execJobFunction: TailorWorkflowAPI["execJobFunction"] = (...args) =>
  api().execJobFunction(...args);

/**
 * Alias for {@link execJobFunction}. Kept for backward compatibility.
 * @deprecated Use {@link execJobFunction} instead.
 * @param args - Forwarded to {@link TailorWorkflowAPI.startJobFunction}
 * @returns The job's return value
 */
export const startJobFunction: TailorWorkflowAPI["startJobFunction"] = (...args) =>
  api().startJobFunction(...args);

/**
 * Frozen alias for {@link execJobFunction}. Kept for backward compatibility.
 * @deprecated Use {@link execJobFunction} instead.
 * @param args - Forwarded to {@link TailorWorkflowAPI.triggerJobFunction}
 * @returns The job's return value
 */
export const triggerJobFunction: TailorWorkflowAPI["triggerJobFunction"] = (...args) =>
  api().triggerJobFunction(...args);

/**
 * See {@link TailorWorkflowAPI.wait}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.wait}
 * @returns The payload supplied by the corresponding `resolve` call
 */
export const wait: TailorWorkflowAPI["wait"] = (...args) => api().wait(...args);

/**
 * See {@link TailorWorkflowAPI.resolve}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.resolve}
 * @returns A promise that resolves once the resolve has been recorded
 */
export const resolve: TailorWorkflowAPI["resolve"] = (...args) => api().resolve(...args);
