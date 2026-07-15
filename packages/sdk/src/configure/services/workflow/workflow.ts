/* oxlint-disable typescript/no-explicit-any */
import { brandValue } from "#/utils/brand";
import { dispatchTriggerWorkflow } from "./registry";
import type { MachineUserName } from "#/configure/types/machine-user";
import type { ConcurrencyPolicy, RetryPolicy } from "#/types/workflow.generated";
import type { WorkflowJob } from "./job";

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
    options?: { invoker: MachineUserName },
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
 *   body: (input: { id: string }) => {
 *     const data = fetchData.trigger({ id: input.id });
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
      trigger: process.env.__TAILOR_PLATFORM_BUNDLE
        ? async () => {
            throw new Error(
              "workflow.trigger() is rewritten at build time and unavailable in the bundle",
            );
          }
        : // Preserve arity: use `arguments.length` (regular function, not arrow) so
          // `.trigger(args, undefined)` is treated as "options passed" — matching
          // the bundler rewrite, which forwards the literal `undefined` from the
          // AST as a third argument. Without this, local execution and bundled
          // workflows would hand mocks different call shapes.
          async function trigger(
            args: Parameters<Job["trigger"]>[0],
            options?: { invoker: MachineUserName },
          ) {
            // oxlint-disable-next-line prefer-rest-params
            return arguments.length >= 2
              ? await dispatchTriggerWorkflow(config.name, args, options)
              : await dispatchTriggerWorkflow(config.name, args);
          },
    } as Workflow<Job>,
    "workflow",
  );
}
