/**
 * Workflow utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.workflow` runtime API.
 * At runtime this delegates to `globalThis.tailor.workflow`. Use `mockWorkflow`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 *
 * `execJobFunction` blocks until the job finishes and returns its result, while
 * `startWorkflow` returns only an execution ID.
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
 * Platform API surface for `tailor.workflow`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.workflow`.
 */
export interface PlatformWorkflowAPI {
  /**
   * Starts a workflow and returns its execution ID.
   * @param workflowName - Workflow name as defined in tailor.config
   * @param args - Arguments forwarded to the workflow's main job
   * @param options - Optional start options (e.g. `authInvoker`)
   * @returns The execution ID of the started workflow
   */
  startWorkflow(workflowName: string, args?: any, options?: StartWorkflowOptions): Promise<string>;

  /**
   * Resumes a failed or pending-retry workflow execution and returns its execution ID.
   * @param executionId - The execution to resume
   * @returns The execution ID of the resumed workflow
   */
  resumeWorkflowExecution(executionId: string): Promise<string>;

  /**
   * Executes a job function and returns its result via durable suspend/replay.
   * @param jobName - Job name as defined in the workflow
   * @param args - Arguments forwarded to the job
   * @param options - Optional execution options (e.g. `executionPolicyKey`)
   * @returns The job's return value
   */
  execJobFunction(jobName: string, args?: any, options?: ExecJobFunctionOptions): any;

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

const api = (): PlatformWorkflowAPI =>
  (globalThis as unknown as { tailor: { workflow: PlatformWorkflowAPI } }).tailor.workflow;

/**
 * See {@link PlatformWorkflowAPI.startWorkflow}.
 * @param args - Forwarded to {@link PlatformWorkflowAPI.startWorkflow}
 * @returns The execution ID of the started workflow
 */
const startWorkflow: PlatformWorkflowAPI["startWorkflow"] = (...args) =>
  api().startWorkflow(...args);

/**
 * See {@link PlatformWorkflowAPI.resumeWorkflowExecution}.
 * @param args - Forwarded to {@link PlatformWorkflowAPI.resumeWorkflowExecution}
 * @returns The execution ID of the resumed workflow
 */
const resumeWorkflowExecution: PlatformWorkflowAPI["resumeWorkflowExecution"] = (...args) =>
  api().resumeWorkflowExecution(...args);

/**
 * See {@link PlatformWorkflowAPI.execJobFunction}.
 *
 * @deprecated since NEXT_RELEASE — call the target job's own `.start()` method
 * instead. codemod: v3/remove-workflow-exec-job-function
 * @param args - Forwarded to {@link PlatformWorkflowAPI.execJobFunction}
 * @returns The job's return value
 */
const execJobFunction: PlatformWorkflowAPI["execJobFunction"] = (...args) =>
  api().execJobFunction(...args);

const wait: PlatformWorkflowAPI["wait"] = (...args) => api().wait(...args);

const resolve: PlatformWorkflowAPI["resolve"] = (...args) => api().resolve(...args);

/** Runtime wrapper namespace for `tailor.workflow`. */
export const workflow = {
  startWorkflow,
  resumeWorkflowExecution,
  execJobFunction,
  wait,
  resolve,
} as const satisfies PlatformWorkflowAPI;
