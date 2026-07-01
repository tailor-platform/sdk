/**
 * Workflow utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.workflow` runtime API.
 * At runtime this delegates to `globalThis.tailor.workflow`. Use `mockWorkflow`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 * @example
 * import { workflow } from "@tailor-platform/sdk/runtime";
 *
 * const executionId = await workflow.triggerWorkflow("myWorkflow", { data: "value" });
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

/** Options for {@link triggerWorkflow}. */
export interface TriggerWorkflowOptions {
  /** Optional authentication invoker to specify which machine user should execute the workflow */
  authInvoker?: AuthInvoker;
}

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
   * Triggers a workflow and returns its execution ID.
   * @param workflowName - Workflow name as defined in tailor.config
   * @param args - Arguments forwarded to the workflow's main job
   * @param options - Optional trigger options (e.g. `authInvoker`)
   * @returns The execution ID of the triggered workflow
   */
  triggerWorkflow(
    workflowName: string,
    args?: any,
    options?: TriggerWorkflowOptions,
  ): Promise<string>;

  /**
   * Resumes a failed or pending-retry workflow execution and returns its execution ID.
   * @param executionId - The execution to resume
   * @returns The execution ID of the resumed workflow
   */
  resumeWorkflow(executionId: string): Promise<string>;

  /**
   * Triggers a job function and returns its result.
   * @param jobName - Job name as defined in the workflow
   * @param args - Arguments forwarded to the job
   * @returns The job's return value
   */
  triggerJobFunction(jobName: string, args?: any): any;

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
 * See {@link TailorWorkflowAPI.triggerWorkflow}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.triggerWorkflow}
 * @returns The execution ID of the triggered workflow
 */
export const triggerWorkflow: TailorWorkflowAPI["triggerWorkflow"] = (...args) =>
  api().triggerWorkflow(...args);

/**
 * See {@link TailorWorkflowAPI.resumeWorkflow}.
 * @param args - Forwarded to {@link TailorWorkflowAPI.resumeWorkflow}
 * @returns The execution ID of the resumed workflow
 */
export const resumeWorkflow: TailorWorkflowAPI["resumeWorkflow"] = (...args) =>
  api().resumeWorkflow(...args);

/**
 * See {@link TailorWorkflowAPI.triggerJobFunction}.
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
