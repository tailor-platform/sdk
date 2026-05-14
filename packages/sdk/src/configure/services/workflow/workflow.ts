/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandValue } from "@/utils/brand";
import type { WorkflowJob } from "./job";
import type { AuthInvoker } from "../auth";
import type { MachineUserName } from "@/configure/types/machine-user";
import type { ConcurrencyPolicy, RetryPolicy } from "@/types/workflow.generated";

export type { ConcurrencyPolicy, RetryPolicy };

export interface WorkflowConfig<
  Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>,
> {
  name: string;
  mainJob: Job;
  retryPolicy?: RetryPolicy;
  concurrencyPolicy?: ConcurrencyPolicy;
}

export interface Workflow<Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
  retryPolicy?: RetryPolicy;
  concurrencyPolicy?: ConcurrencyPolicy;
  trigger: (
    args: Parameters<Job["trigger"]>[0],
    options?: { authInvoker: AuthInvoker<string> | MachineUserName },
  ) => Promise<string>;
}

interface WorkflowDefinition<Job extends WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
  retryPolicy?: RetryPolicy;
  concurrencyPolicy?: ConcurrencyPolicy;
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
 *   body: async (input: { id: string }) => {
 *     const data = await fetchData.trigger({ id: input.id });
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
  return brandValue(
    {
      ...config,
      // For local execution, directly call mainJob.trigger()
      // In production, bundler transforms this to tailor.workflow.triggerWorkflow()
      trigger: async (args) => {
        await config.mainJob.trigger(...([args] as unknown as []));
        return "00000000-0000-0000-0000-000000000000";
      },
    },
    "workflow",
  );
}
