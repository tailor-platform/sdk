import type { JsonCompatible } from "@/configure/types/helpers";
import type { Jsonifiable, Jsonify } from "type-fest";

/**
 * Phantom type marker for a wait point definition.
 * Runtime value is an empty object; only the type parameters matter.
 */
export type WaitPointDef<Payload = undefined, Result = undefined> = {
  /** @internal */
  readonly _payload?: Payload;
  /** @internal */
  readonly _result?: Result;
};

/**
 * Map of wait point key to its definition.
 */
// oxlint-disable-next-line no-explicit-any
export type WaitPointsConfig = Record<string, WaitPointDef<any, any>>;

/** Extract the Payload type from a WaitPointDef */
export type ExtractPayload<T> = T extends WaitPointDef<infer P, infer _R> ? P : never;

/** Extract the Result type from a WaitPointDef */
export type ExtractResult<T> = T extends WaitPointDef<infer _P, infer R> ? R : never;

/**
 * Convert output type to what wait returns after JSON serialization.
 * Same transform as trigger return: Date → string, etc.
 */
type JsonifyOutput<T> = T extends Jsonifiable ? Jsonify<T> : T;

/**
 * Allowed payload types for wait points.
 * Same constraint as WorkflowJobInput: JSON-compatible, no Date/toJSON.
 */
export type WaitPointPayload = undefined | JsonCompatible<unknown>;

/**
 * Allowed result types for wait points.
 * Same constraint as WorkflowJobOutput: Jsonifiable (including Date), undefined, void.
 */
export type WaitPointResult = Jsonifiable | undefined | void;

/**
 * Type of the `wait` function passed to workflow job bodies via context.
 * Generic over the key — only keys declared in `waitPoints` are accepted.
 *
 * At runtime (local testing), returns a Promise that resolves when `resolve()` is called.
 * In production, the bundler injects `tailor.workflow.wait` which synchronously suspends.
 * Users may use `await` for readability — it is harmless on a synchronous return.
 */
export type WaitFn<W extends WaitPointsConfig> = <K extends string & keyof W>(
  key: K,
  ...args: [ExtractPayload<W[K]>] extends [undefined] ? [] : [payload: ExtractPayload<W[K]>]
) => Promise<JsonifyOutput<ExtractResult<W[K]>>>;

/**
 * Type of the `resolve` method on a WorkflowJob that has wait points.
 * Called from resolvers, executors, or other workflow jobs to resume a waiting execution.
 *
 * The callback receives the wait payload and returns a result.
 * During bundling:
 *   `job.resolve("key", executionId, cb)` → `tailor.workflow.resolve(executionId, "key", cb)`
 */
export type ResolveFn<W extends WaitPointsConfig> = <K extends string & keyof W>(
  key: K,
  executionId: string,
  callback: (
    payload: [ExtractPayload<W[K]>] extends [undefined] ? undefined : ExtractPayload<W[K]>,
  ) => ExtractResult<W[K]> | Promise<ExtractResult<W[K]>>,
) => Promise<void>;

/**
 * Define a wait point with typed payload and result.
 * Used in the `waitPoints` config of `createWorkflowJob`.
 * @returns A phantom-typed marker (empty object at runtime)
 * @example
 * createWorkflowJob({
 *   name: "my-job",
 *   waitPoints: {
 *     approval: waitPoint<{ message: string }, { approved: boolean }>(),
 *   },
 *   body: async (input, { wait }) => {
 *     const result = await wait("approval", { message: "Please approve" });
 *     return { approved: result.approved };
 *   },
 * });
 */
export function waitPoint<Payload = undefined, Result = undefined>(): WaitPointDef<
  Payload,
  Result
> {
  return {} as WaitPointDef<Payload, Result>;
}
