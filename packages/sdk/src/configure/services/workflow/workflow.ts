/* oxlint-disable typescript/no-explicit-any */
import { brandValue } from "@/utils/brand";
import { getPlatformWorkflow, registerWorkflow } from "./registry";
import type { AuthInvoker } from "../auth";
import type { WorkflowJob } from "./job";
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
  // Registry + trigger shim are test-only (see createWorkflowJob); a platform
  // bundle rewrites `.trigger()` and never reads the registry, so the
  // `__TAILOR_PLATFORM_BUNDLE__` guard drops both as dead code there.
  if (!globalThis.__TAILOR_PLATFORM_BUNDLE__) {
    registerWorkflow(config.name, config.mainJob.name);
  }

  return brandValue(
    {
      ...config,
      trigger: globalThis.__TAILOR_PLATFORM_BUNDLE__
        ? () => {
            throw new Error(
              "workflow.trigger() is rewritten at build time and unavailable in the bundle",
            );
          }
        : async (args, options) =>
            await getPlatformWorkflow().triggerWorkflow(config.name, args, options),
    } as Workflow<Job>,
    "workflow",
  );
}
