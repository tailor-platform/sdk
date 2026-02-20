/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkflowJob } from "./job";
import type { AuthInvoker } from "../auth";

export interface WorkflowConfig<
  Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>,
> {
  name: string;
  mainJob: Job;
}

export interface Workflow<Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
  trigger: (
    args: Parameters<Job["trigger"]>[0],
    options?: { authInvoker: AuthInvoker<string> },
  ) => Promise<string>;
}

interface WorkflowDefinition<Job extends WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
}

/**
 * Create a workflow definition that can be triggered via the Tailor SDK.
 * In production, bundler transforms .trigger() calls to tailor.workflow.triggerWorkflow().
 *
 * The workflow MUST be the default export of the file.
 * All jobs referenced by the workflow MUST be named exports.
 * @template Job
 * @param config - Workflow configuration
 * @returns Defined workflow
 * @example
 * export const fetchData = createWorkflowJob({ name: "fetch-data", body: async (input: { id: string }) => ({ id: input.id }) });
 * export const processData = createWorkflowJob({
 *   name: "process-data",
 *   body: (input: { id: string }) => {
 *     const data = fetchData.trigger({ id: input.id }); // do NOT await
 *     return { data };
 *   },
 * });
 *
 * // Workflow must be default export; mainJob is the entry point
 * export default createWorkflow({
 *   name: "data-processing",
 *   mainJob: processData,
 * });
 */
export function createWorkflow<Job extends WorkflowJob<any, any, any>>(
  config: WorkflowDefinition<Job>,
): Workflow<Job> {
  return {
    ...config,
    // For local execution, directly call mainJob.trigger()
    // In production, bundler transforms this to tailor.workflow.triggerWorkflow()
    trigger: async (args) => {
      await config.mainJob.trigger(...([args] as unknown as []));
      return "00000000-0000-0000-0000-000000000000";
    },
  };
}
