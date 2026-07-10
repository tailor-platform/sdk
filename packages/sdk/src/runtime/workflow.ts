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
export interface Invoker {
  /** The namespace where the machine user is defined */
  namespace: string;
  /** The name of the machine user to use for workflow execution */
  machineUserName: string;
}

/** Options for {@link triggerWorkflow}. */
export interface TriggerWorkflowOptions {
  /** Optional invoker to specify which machine user should execute the workflow */
  invoker?: Invoker;
}

export interface PlatformTriggerWorkflowOptions {
  authInvoker?: Invoker;
}

/**
 * Platform API surface for `tailor.workflow`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.workflow`.
 */
export interface PlatformWorkflowAPI {
  /**
   * Triggers a workflow and returns its execution ID.
   * @param workflowName - Workflow name as defined in tailor.config
   * @param args - Arguments forwarded to the workflow's main job
   * @param options - Optional platform trigger options
   * @returns The execution ID of the triggered workflow
   */
  triggerWorkflow(
    workflowName: string,
    args?: any,
    options?: PlatformTriggerWorkflowOptions,
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

const resumeWorkflow: PlatformWorkflowAPI["resumeWorkflow"] = (...args) =>
  api().resumeWorkflow(...args);

const triggerJobFunction: PlatformWorkflowAPI["triggerJobFunction"] = (...args) =>
  api().triggerJobFunction(...args);

const wait: PlatformWorkflowAPI["wait"] = (...args) => api().wait(...args);

const resolve: PlatformWorkflowAPI["resolve"] = (...args) => api().resolve(...args);

/** Runtime wrapper namespace for `tailor.workflow`. */
export const workflow = {
  triggerWorkflow,
  resumeWorkflow,
  triggerJobFunction,
  wait,
  resolve,
} as const satisfies TailorWorkflowAPI;
