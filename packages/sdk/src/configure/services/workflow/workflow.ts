/* oxlint-disable typescript/no-explicit-any */
import { brandValue } from "#/utils/brand";
import { dispatchStartWorkflow } from "./registry";
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
  publishEvents?: boolean;
}

export interface Workflow<Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
  retryPolicy?: RetryPolicy;
  concurrencyPolicy?: ConcurrencyPolicy;
  publishEvents?: boolean;
  start: [Parameters<Job["start"]>[0]] extends [undefined]
    ? (args?: undefined, options?: { invoker: MachineUserName }) => Promise<string>
    : (
        args: Parameters<Job["start"]>[0],
        options?: { invoker: MachineUserName },
      ) => Promise<string>;
}

interface WorkflowDefinition<Job extends WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
  retryPolicy?: RetryPolicy;
  concurrencyPolicy?: ConcurrencyPolicy;
  /**
   * Enable publishing this workflow's execution events, letting executors with
   * a `workflowExecution*` trigger observe them.
   *
   * Left unset, it is enabled automatically when an executor in the project
   * subscribes to this workflow's execution events.
   */
  publishEvents?: boolean;
}

/**
 * Create a workflow definition that can be started via the Tailor SDK.
 * In production, the bundler rewrites `.start()` calls into direct platform workflow calls.
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
 *     const data = fetchData.start({ id: input.id });
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
      start: process.env.__TAILOR_PLATFORM_BUNDLE
        ? async () => {
            throw new Error(
              "workflow.start() is rewritten at build time and unavailable in the bundle",
            );
          }
        : // Preserve arity: use `arguments.length` (regular function, not arrow) so
          // `.start(args, undefined)` is treated as "options passed" — matching
          // the bundler rewrite, which forwards the literal `undefined` from the
          // AST as a third argument. Without this, local execution and bundled
          // workflows would hand mocks different call shapes.
          async function start(
            args: Parameters<Job["start"]>[0],
            options?: { invoker: MachineUserName },
          ) {
            // oxlint-disable-next-line prefer-rest-params
            return arguments.length >= 2
              ? await dispatchStartWorkflow(config.name, args, options)
              : await dispatchStartWorkflow(config.name, args);
          },
    } as Workflow<Job>,
    "workflow",
  );
}
