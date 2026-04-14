import { brandValue } from "@/utils/brand";
import type { WaitPointsConfig, WaitFn, ResolveFn } from "./wait-point";
import type { TailorEnv } from "@/configure/types/env";
import type { JsonCompatible } from "@/configure/types/helpers";
import type { Jsonifiable, Jsonify, JsonPrimitive } from "type-fest";

/**
 * Context object passed as the second argument to workflow job body functions.
 * When the job declares `waitPoints`, the context includes a typed `wait` function.
 */
export type WorkflowJobContext<W extends WaitPointsConfig = WaitPointsConfig> = {
  env: TailorEnv;
  wait: WaitFn<W>;
};

/**
 * Allowed output types for workflow job body functions.
 * Includes Jsonifiable (JSON-serializable values including objects with toJSON like Date),
 * undefined, and void.
 */
export type WorkflowJobOutput = Jsonifiable | undefined | void;

/**
 * Convert output type to what trigger returns after JSON serialization.
 * - Jsonifiable values are converted via Jsonify (Date -> string, etc.)
 * - undefined remains undefined
 * - void becomes void
 */
type JsonifyOutput<T> = T extends Jsonifiable ? Jsonify<T> : T;

/**
 * Input type constraint for workflow jobs.
 * Accepts any type that is JSON-compatible (primitives, arrays, objects with JSON-compatible values).
 * Excludes objects with toJSON method (like Date) since they won't be serialized in input.
 */
export type WorkflowJobInput = undefined | JsonCompatible<unknown>;

/**
 * WorkflowJob represents a job that can be triggered in a workflow.
 *
 * Type constraints:
 * - Input: Must be JSON-compatible (no Date/toJSON objects) or undefined. Interfaces are allowed.
 * - Output: Must be Jsonifiable, undefined, or void
 * - Trigger returns Jsonify<Output> (Date becomes string after JSON.stringify)
 * - WaitPoints: Optional map of wait point keys to WaitPointDef for wait/resolve support
 */
export interface WorkflowJob<
  Name extends string = string,
  Input = undefined,
  Output = undefined,
  WaitPoints extends WaitPointsConfig = WaitPointsConfig,
> {
  name: Name;
  /**
   * Trigger this job with the given input.
   * At runtime, this is a placeholder that calls the body function.
   * During bundling, calls to .trigger() are transformed to
   * tailor.workflow.triggerJobFunction("<job-name>", args).
   *
   * Returns Jsonify<Output> because the value passes through JSON.stringify.
   *
   * Inside a workflow job body, .trigger() calls are transformed by the bundler
   * into synchronous `triggerJobFunction` calls. You may use `await` for
   * readability — the bundler strips it automatically at build time.
   * @example
   * // Both styles work — await is stripped by the bundler:
   * body: async (input) => {
   *   const a = await jobA.trigger({ id: input.id });
   *   const b = await jobB.trigger({ id: input.id });
   *   return { a, b };
   * }
   */
  trigger: [Input] extends [undefined]
    ? () => Promise<JsonifyOutput<Awaited<Output>>>
    : (input: Input) => Promise<JsonifyOutput<Awaited<Output>>>;
  body: (input: Input, context: WorkflowJobContext<WaitPoints>) => Output | Promise<Output>;
  /**
   * Resolve a waiting execution for this job.
   * Called from resolvers, executors, or other workflow jobs.
   *
   * During bundling:
   *   `job.resolve("key", executionId, cb)` → `tailor.workflow.resolve(executionId, "key", cb)`
   * @example
   * await processOrder.resolve("approval", executionId, (payload) => {
   *   return { approved: true };
   * });
   */
  resolve: ResolveFn<WaitPoints>;
}

/**
 * Helper type to check if all property types are valid.
 * Uses -? to remove optional modifiers so all properties are treated uniformly.
 */
type AllPropertiesValid<T> = {
  [K in keyof T]-?: IsValidInput<T[K]> extends true ? true : false;
}[keyof T] extends true
  ? true
  : false;

/**
 * Check if a type contains any non-JSON-compatible values.
 * Returns `true` if the type is valid for input, `false` otherwise.
 *
 * Accepts:
 * - JSON primitives (string, number, boolean, null)
 * - undefined
 * - Optional primitives (e.g., string | undefined)
 * - Arrays of valid types
 * - Objects with valid field types
 *
 * Rejects:
 * - Objects with toJSON methods (like Date)
 * - Other non-JSON-serializable types
 */
type IsValidInput<T> = T extends undefined
  ? true
  : T extends JsonPrimitive
    ? true
    : T extends readonly (infer U)[]
      ? IsValidInput<U>
      : T extends object
        ? T extends { toJSON: () => unknown }
          ? false
          : AllPropertiesValid<T>
        : false;

/**
 * Helper type to check if all property types are valid for output.
 * Uses -? to remove optional modifiers so all properties are treated uniformly.
 */
type AllPropertiesValidOutput<T> = {
  [K in keyof T]-?: IsValidOutput<T[K]> extends true ? true : false;
}[keyof T] extends true
  ? true
  : false;

/**
 * Check if a type is valid for output.
 * Returns `true` if the type is valid, `false` otherwise.
 *
 * Accepts:
 * - JSON primitives (string, number, boolean, null)
 * - undefined and void
 * - Optional primitives (e.g., string | undefined)
 * - Jsonifiable types (Date, objects with toJSON)
 * - Arrays of valid types
 * - Objects with valid field types
 */
type IsValidOutput<T> = T extends undefined | void
  ? true
  : T extends JsonPrimitive
    ? true
    : T extends readonly (infer U)[]
      ? IsValidOutput<U>
      : T extends object
        ? AllPropertiesValidOutput<T>
        : false;

/**
 * Body function type with conditional constraint.
 * If input contains invalid types (like Date), the body type becomes `never` to cause an error.
 */
type WorkflowJobBody<I, O, W extends WaitPointsConfig = WaitPointsConfig> =
  IsValidInput<I> extends true
    ? IsValidOutput<O> extends true
      ? (input: I, context: WorkflowJobContext<W>) => O | Promise<O>
      : never
    : never;

/**
 * Environment variable key for workflow testing.
 * Contains JSON-serialized TailorEnv object.
 */
export const WORKFLOW_TEST_ENV_KEY = "TAILOR_TEST_WORKFLOW_ENV";

/**
 * Create a workflow job definition.
 *
 * All jobs must be named exports from the workflow file.
 * Job names must be unique across the entire project.
 * @param config - Job configuration with name, body function, and optional waitPoints
 * @param config.name - Unique job name across the project
 * @param config.body - Async function that processes the job input
 * @param config.waitPoints - Optional map of wait point definitions for wait/resolve support
 * @returns A WorkflowJob that can be triggered from other jobs
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
 * // await is optional — the bundler strips it at build time.
 * export const orchestrate = createWorkflowJob({
 *   name: "orchestrate",
 *   body: async (input: { orderId: string }) => {
 *     const inventory = await checkInventory.trigger({ orderId: input.orderId });
 *     const payment = await processPayment.trigger({ orderId: input.orderId });
 *     return { inventory, payment };
 *   },
 * });
 * @example
 * // Job with wait/resolve for human-in-the-loop workflows:
 * export const processOrder = createWorkflowJob({
 *   name: "process-order",
 *   waitPoints: {
 *     approval: waitPoint<{ message: string }, { approved: boolean }>(),
 *   },
 *   body: async (input: { orderId: string }, { wait }) => {
 *     const result = await wait("approval", { message: `Approve ${input.orderId}?` });
 *     return { orderId: input.orderId, approved: result.approved };
 *   },
 * });
 */
export const createWorkflowJob = <
  const Name extends string,
  I = undefined,
  O = undefined,
  W extends WaitPointsConfig = Record<string, never>,
>(config: {
  readonly name: Name;
  readonly body: WorkflowJobBody<I, O, W>;
  readonly waitPoints?: W;
}): WorkflowJob<Name, I, Awaited<O>, W> => {
  // In-memory coordination for local testing of wait/resolve.
  // In production, the bundler injects tailor.workflow.wait directly.
  const pendingWaits = new Map<string, { payload: unknown; resolve: (result: unknown) => void }>();

  const waitFn = async (key: string, payload?: unknown) => {
    return new Promise((resolvePromise) => {
      pendingWaits.set(key, { payload, resolve: resolvePromise });
    });
  };

  const resolveFn = async (
    key: string,
    _executionId: string,
    callback: (p: unknown) => unknown,
  ) => {
    const pending = pendingWaits.get(key);
    if (!pending) {
      throw new Error(`No pending wait for key "${key}" on job "${config.name}"`);
    }
    const result = await callback(pending.payload);
    pending.resolve(result ? JSON.parse(JSON.stringify(result)) : result);
    pendingWaits.delete(key);
  };

  return brandValue(
    {
      name: config.name,
      // JSON.parse(JSON.stringify(...)) ensures the return value matches Jsonify<Output> type.
      // This converts Date objects to strings, matching actual runtime behavior.
      // In production, bundler transforms .trigger() calls to tailor.workflow.triggerJobFunction().
      trigger: async (args?: unknown) => {
        const env: TailorEnv = JSON.parse(process.env[WORKFLOW_TEST_ENV_KEY] || "{}");
        const result = await config.body(args as I, { env, wait: waitFn } as WorkflowJobContext<W>);
        return result ? JSON.parse(JSON.stringify(result)) : result;
      },
      body: config.body,
      resolve: resolveFn,
    } as WorkflowJob<Name, I, Awaited<O>, W>,
    "workflow-job",
  );
};
