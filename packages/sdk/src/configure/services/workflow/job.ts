import { brandValue } from "#/utils/brand";
import { dispatchStartJob, registerJob, type RegisteredJobBody } from "./registry";
import { withWorkflowTestInvoker } from "./test-env-key";
import type { TailorEnv, TailorPrincipal } from "#/runtime/types";
import type { ExecJobFunctionOptions } from "#/runtime/workflow";
import type { JsonCompatible, TypeLevelError } from "#/types/helpers";

/**
 * Context object passed as the second argument to workflow job body functions.
 */
export type WorkflowJobContext = {
  env: TailorEnv;
  invoker: TailorPrincipal | null;
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
 * WorkflowJob represents a job that can be started from a workflow.
 *
 * Type constraints:
 * - Input: Must be JsonValue-compatible (plain objects/arrays; no class instances or functions) or undefined.
 * - Output: Must be JsonValue-compatible (plain objects/arrays; no class instances or functions), undefined, or void.
 * - Start returns `Awaited<Output>` as-is (no Promise or Jsonify transformation).
 */
export interface WorkflowJob<Name extends string = string, Input = undefined, Output = undefined> {
  name: Name;
  /**
   * Start this job with the given input and return the job's output value.
   * Accepts an optional second argument to pass `executionPolicyKey` for
   * platform-side concurrency enforcement.
   * @example
   * body: async (input) => {
   *   const a = jobA.start({ id: input.id });
   *   const b = jobB.start({ id: input.id }, {
   *     executionPolicyKey: `tenant-api.${input.tenantId}`,
   *   });
   *   return { a, b };
   * }
   */
  start: [Input] extends [undefined]
    ? (input?: undefined, options?: ExecJobFunctionOptions) => Awaited<Output>
    : (input: Input, options?: ExecJobFunctionOptions) => Awaited<Output>;
  body: (input: Input, context: WorkflowJobContext) => Output | Promise<Output>;
  publishEvents?: boolean;
}

interface CreateWorkflowJobConfig<Name extends string, I, O> {
  readonly name: Name;
  readonly body: JobBody<I, O>;
  /**
   * Enable publishing this job's execution events, letting executors with a
   * `workflowJobExecution*` trigger observe them.
   *
   * Left unset, it is enabled automatically when an executor in the project
   * subscribes to the job execution events of a workflow that runs this job.
   */
  readonly publishEvents?: boolean;
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
 * @param config.body - Function that processes the job input.
 * @returns A WorkflowJob that can be started from other jobs.
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
 *   body: (input: { orderId: string }) => {
 *     const inventory = checkInventory.start({ orderId: input.orderId });
 *     const payment = processPayment.start({ orderId: input.orderId });
 *     return { inventory, payment };
 *   },
 * });
 */
export function createWorkflowJob<const Name extends string, I = undefined, O = undefined>(
  config: CreateWorkflowJobConfig<Name, I, O>,
): WorkflowJob<Name, I, Awaited<O>> {
  const userBody = config.body as (input: I, context: WorkflowJobContext) => O | Promise<O>;
  const body = process.env.__TAILOR_PLATFORM_BUNDLE
    ? userBody
    : (input: I, context: WorkflowJobContext): O | Promise<O> =>
        withWorkflowTestInvoker(context.invoker, () => userBody(input, context));

  // Test-only local runner registry; the platform bundle sets the flag so it is DCE'd.
  if (!process.env.__TAILOR_PLATFORM_BUNDLE) {
    registerJob(config.name, body as RegisteredJobBody);
  }

  const start = process.env.__TAILOR_PLATFORM_BUNDLE
    ? () => {
        throw new Error(
          `Workflow job "${config.name}"'s .start() is rewritten at build time and is unavailable in the bundle`,
        );
      }
    : // Preserve arity: use `arguments.length` (regular function, not arrow) so
      // `.start(args, undefined)` is treated as "options passed" — matching
      // the bundler rewrite, which forwards the literal `undefined` from the
      // AST as a third argument. Without this, local execution and bundled
      // workflows would hand mocks different call shapes.
      function start(args?: unknown, options?: ExecJobFunctionOptions) {
        // oxlint-disable-next-line prefer-rest-params
        return (
          arguments.length >= 2
            ? dispatchStartJob(config.name, args, options)
            : dispatchStartJob(config.name, args)
        ) as Awaited<O>;
      };

  return brandValue(
    {
      name: config.name,
      start,
      body,
      ...(config.publishEvents !== undefined ? { publishEvents: config.publishEvents } : {}),
    } as WorkflowJob<Name, I, Awaited<O>>,
    "workflow-job",
  );
}
