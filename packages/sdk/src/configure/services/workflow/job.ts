import { brandValue } from "#/utils/brand";
import { dispatchTriggerJob, registerJob, type RegisteredJobBody } from "./registry";
import type { TailorEnv, TailorInvoker } from "#/runtime/types";
import type { TriggerJobFunctionOptions } from "#/runtime/workflow";
import type { JsonCompatible, TypeLevelError } from "#/types/helpers";

/**
 * Context object passed as the second argument to workflow job body functions.
 */
export type WorkflowJobContext = {
  env: TailorEnv;
  invoker?: TailorInvoker;
};

/**
 * The body function type for a workflow job.
 * Resolves to the callable signature when `I` / `O` are JsonValue-compatible,
 * or to a type-level error that surfaces at the `body:` property.
 */
type JobBody<I, O> = [null] extends [I]
  ? TypeLevelError<"Input cannot be null at the top level">
  : [I] extends [undefined]
    ? [O] extends [JsonCompatible<O> | undefined | void]
      ? (input: I, context: WorkflowJobContext) => O | Promise<O>
      : TypeLevelError<"Output must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">
    : [undefined] extends [I]
      ? TypeLevelError<"Input cannot include undefined at the top level">
      : [I] extends [JsonCompatible<I>]
        ? [O] extends [JsonCompatible<O> | undefined | void]
          ? (input: I, context: WorkflowJobContext) => O | Promise<O>
          : TypeLevelError<"Output must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">
        : TypeLevelError<"Input must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">;

/**
 * WorkflowJob represents a job that can be triggered in a workflow.
 *
 * Type constraints:
 * - Input: Must be JsonValue-compatible (plain objects/arrays; no class instances or functions) or undefined.
 * - Output: Must be JsonValue-compatible (plain objects/arrays; no class instances or functions), undefined, or void.
 * - Trigger returns `Awaited<Output>` as-is (no Jsonify transformation).
 */
export interface WorkflowJob<Name extends string = string, Input = undefined, Output = undefined> {
  name: Name;
  /**
   * Trigger this job with the given input. Returns a Promise that resolves
   * to the job's output value. Accepts an optional second argument to pass
   * `executionPolicyKey` for platform-side concurrency enforcement.
   * @example
   * body: async (input) => {
   *   const a = await jobA.trigger({ id: input.id });
   *   const b = await jobB.trigger({ id: input.id }, {
   *     executionPolicyKey: `tenant-api.${input.tenantId}`,
   *   });
   *   return { a, b };
   * }
   */
  trigger: [Input] extends [undefined]
    ? (input?: undefined, options?: TriggerJobFunctionOptions) => Promise<Awaited<Output>>
    : (input: Input, options?: TriggerJobFunctionOptions) => Promise<Awaited<Output>>;
  body: (input: Input, context: WorkflowJobContext) => Output | Promise<Output>;
}

export { WORKFLOW_TEST_ENV_KEY } from "./test-env-key";

interface CreateWorkflowJobConfig<Name extends string, I, O> {
  readonly name: Name;
  readonly body: JobBody<I, O>;
}

/**
 * Create a workflow job definition.
 *
 * All jobs must be named exports from the workflow file.
 * Job names must be unique across the entire project.
 *
 * Input and output must be JsonValue-compatible (primitives, plain objects, arrays).
 * Functions and objects with a `toJSON` method are rejected at the type level;
 * class instances exposing methods are rejected via the property walk.
 * @param config - Job configuration with name and body function.
 * @param config.name - Unique job name across the project.
 * @param config.body - Async function that processes the job input.
 * @returns A WorkflowJob that can be triggered from other jobs.
 * @example
 * // Simple job with async body:
 * export const fetchData = createWorkflowJob({
 *   name: "fetch-data",
 *   body: async (input: { id: string }) => {
 *     const db = getDB("tailordb");
 *     return await db.selectFrom("Table").selectAll().where("id", "=", input.id).executeTakeFirst();
 *   },
 * });
 * @example
 * // Orchestrator job that fans out to other jobs.
 * export const orchestrate = createWorkflowJob({
 *   name: "orchestrate",
 *   body: async (input: { orderId: string }) => {
 *     const inventory = await checkInventory.trigger({ orderId: input.orderId });
 *     const payment = await processPayment.trigger({ orderId: input.orderId });
 *     return { inventory, payment };
 *   },
 * });
 */
export function createWorkflowJob<const Name extends string, I = undefined, O = undefined>(
  config: CreateWorkflowJobConfig<Name, I, O>,
): WorkflowJob<Name, I, Awaited<O>> {
  const body = config.body as (input: I, context: WorkflowJobContext) => O | Promise<O>;

  // Test-only registry/trigger shim; the platform bundle sets the flag so it is DCE'd.
  if (!process.env.TAILOR_PLATFORM_BUNDLE) {
    registerJob(config.name, body as RegisteredJobBody);
  }

  const trigger = process.env.TAILOR_PLATFORM_BUNDLE
    ? async () => {
        throw new Error(
          "This workflow job's .trigger() is rewritten at build time and is unavailable in the bundle",
        );
      }
    : async (args?: unknown, options?: TriggerJobFunctionOptions) =>
        (await dispatchTriggerJob(config.name, args, options)) as Awaited<O>;

  return brandValue(
    { name: config.name, trigger, body } as WorkflowJob<Name, I, Awaited<O>>,
    "workflow-job",
  );
}
