import type { TailorEnv } from "@/configure/types/env";
import type { JsonCompatible } from "@/configure/types/helpers";
import type { Jsonifiable, Jsonify, JsonPrimitive } from "type-fest";

/**
 * Symbol used to brand WorkflowJob objects created by createWorkflowJob.
 * This enables reliable runtime detection of workflow jobs regardless of
 * how they were imported or assigned (variable reassignment, destructuring, etc.)
 */
export const WORKFLOW_JOB_BRAND = Symbol.for("tailor:workflow-job");

/**
 * Context object passed as the second argument to workflow job body functions.
 */
export type WorkflowJobContext = {
  env: TailorEnv;
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
 */
export interface WorkflowJob<Name extends string = string, Input = undefined, Output = undefined> {
  readonly [WORKFLOW_JOB_BRAND]?: true;
  name: Name;
  /**
   * Trigger this job with the given input.
   * At runtime, this is a placeholder that calls the body function.
   * During bundling, calls to .trigger() are transformed to
   * tailor.workflow.triggerJobFunction("<job-name>", args).
   *
   * Returns Jsonify<Output> because the value passes through JSON.stringify.
   */
  trigger: [Input] extends [undefined]
    ? () => Promise<JsonifyOutput<Awaited<Output>>>
    : (input: Input) => Promise<JsonifyOutput<Awaited<Output>>>;
  body: (input: Input, context: WorkflowJobContext) => Output | Promise<Output>;
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
type WorkflowJobBody<I, O> =
  IsValidInput<I> extends true
    ? IsValidOutput<O> extends true
      ? (input: I, context: WorkflowJobContext) => O | Promise<O>
      : never
    : never;

/**
 * Environment variable key for workflow testing.
 * Contains JSON-serialized TailorEnv object.
 */
export const WORKFLOW_TEST_ENV_KEY = "TAILOR_TEST_WORKFLOW_ENV";

export const createWorkflowJob = <const Name extends string, I = undefined, O = undefined>(config: {
  readonly name: Name;
  readonly body: WorkflowJobBody<I, O>;
}): WorkflowJob<Name, I, Awaited<O>> => {
  return {
    [WORKFLOW_JOB_BRAND]: true,
    name: config.name,
    // JSON.parse(JSON.stringify(...)) ensures the return value matches Jsonify<Output> type.
    // This converts Date objects to strings, matching actual runtime behavior.
    // In production, bundler transforms .trigger() calls to tailor.workflow.triggerJobFunction().
    trigger: async (args?: unknown) => {
      const env: TailorEnv = JSON.parse(process.env[WORKFLOW_TEST_ENV_KEY] || "{}");
      const result = await config.body(args as I, { env });
      return result ? JSON.parse(JSON.stringify(result)) : result;
    },
    body: config.body,
  } as WorkflowJob<Name, I, Awaited<O>>;
};
