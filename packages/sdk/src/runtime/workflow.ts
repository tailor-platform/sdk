/**
 * Workflow utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.workflow` runtime API.
 * At runtime this delegates to `globalThis.tailor.workflow`. Use `workflowMock`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 * @example
 * import { workflow } from "@tailor-platform/sdk/runtime";
 *
 * const executionId = await workflow.triggerWorkflow("myWorkflow", { data: "value" });
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { runtime } from "./internal";

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
 * @internal
 */
export interface TailorWorkflowAPI {
  triggerWorkflow(
    workflow_name: string,
    args?: any,
    options?: TriggerWorkflowOptions,
  ): Promise<string>;
  triggerJobFunction(job_name: string, args?: any): any;
  wait(key: string, payload?: any): any;
  resolve(executionId: string, key: string, callback: (waitPayload: any) => any): Promise<void>;
}

/**
 * Triggers a workflow and returns its execution ID.
 * @param workflow_name - Workflow name as defined in tailor.config
 * @param args - Arguments forwarded to the workflow's main job
 * @param options - Optional trigger options (e.g. `authInvoker`)
 * @returns The execution ID of the triggered workflow
 */
export function triggerWorkflow(
  workflow_name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any,
  options?: TriggerWorkflowOptions,
): Promise<string> {
  return runtime.tailor.workflow.triggerWorkflow(workflow_name, args, options);
}

/**
 * Triggers a job function and returns its result.
 * @param job_name - Job name as defined in the workflow
 * @param args - Arguments forwarded to the job
 * @returns The job's return value
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function triggerJobFunction(job_name: string, args?: any): any {
  return runtime.tailor.workflow.triggerJobFunction(job_name, args);
}

/**
 * Suspends the current workflow execution and waits for an external signal to resume.
 * @param key - Wait point key
 * @param payload - Optional payload to record with the wait point
 * @returns The payload supplied by the corresponding `resolve` call
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wait(key: string, payload?: any): any {
  return runtime.tailor.workflow.wait(key, payload);
}

/**
 * Resolves a waiting workflow execution, causing it to resume.
 * @param executionId - The execution to resume
 * @param key - Wait point key to resolve
 * @param callback - Callback receiving the wait payload; its return value is forwarded to `wait`
 * @returns A promise that resolves once the resolve has been recorded
 */
export function resolve(
  executionId: string,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (waitPayload: any) => any,
): Promise<void> {
  return runtime.tailor.workflow.resolve(executionId, key, callback);
}
