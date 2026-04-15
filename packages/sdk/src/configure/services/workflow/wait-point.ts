import { brandValue } from "@/utils/brand";
import type { Jsonifiable, Jsonify } from "type-fest";

type JsonifyOutput<T> = T extends Jsonifiable ? Jsonify<T> : T;

/**
 * A single wait point instance with typed `.wait()` and `.resolve()` methods.
 *
 * - `.wait(payload?)` suspends execution until resolved. Returns the result from `.resolve()`.
 * - `.resolve(executionId, callback)` resumes a suspended execution.
 */
export interface WaitPointInstance<Payload = undefined, Result = undefined> {
  wait: [Payload] extends [undefined]
    ? () => Promise<JsonifyOutput<Result>>
    : (payload: Payload) => Promise<JsonifyOutput<Result>>;
  resolve: (
    executionId: string,
    callback: (
      payload: [Payload] extends [undefined] ? undefined : Payload,
    ) => Result | Promise<Result>,
  ) => Promise<void>;
}

// Internal symbol used by defineWaitPoints to set the correct key on each
// instance after the builder callback has assembled the object.
const SET_KEY = Symbol.for("@tailor-platform/sdk/waitPoint/setKey");

interface WaitPointInternals {
  [SET_KEY]?: (key: string) => void;
}

/**
 * Create a WaitPointInstance with in-memory coordination for local testing.
 * The key starts as a placeholder and is updated by `defineWaitPoints` after
 * the builder callback returns.
 * @param initialKey - Initial key (used in error messages until updated)
 * @returns A WaitPointInstance with local testing coordination
 */
function createWaitPointInstance(initialKey: string): WaitPointInstance<unknown, unknown> {
  let key = initialKey;
  const pendingWaits = new Map<string, { payload: unknown; resolve: (result: unknown) => void }>();

  const instance = brandValue(
    {
      wait(payload?: unknown) {
        // Production: delegate to platform API
        const platformWait = (
          globalThis as {
            tailor?: { workflow?: { wait?: (k: string, p?: unknown) => unknown } };
          }
        ).tailor?.workflow?.wait;
        if (platformWait) {
          // Wrap in Promise.resolve since the platform's wait is synchronous but our type signature is async
          return Promise.resolve(platformWait(key, payload)) as Promise<unknown>;
        }
        // Local testing: in-memory coordination
        return new Promise<unknown>((resolve) => {
          pendingWaits.set("pending", { payload, resolve });
        });
      },
      async resolve(executionId: string, callback: (p: unknown) => unknown) {
        // Production: delegate to platform API
        const platformResolve = (
          globalThis as {
            tailor?: {
              workflow?: {
                resolve?: (e: string, k: string, c: (p: unknown) => unknown) => Promise<void>;
              };
            };
          }
        ).tailor?.workflow?.resolve;
        if (platformResolve) {
          await platformResolve(executionId, key, callback);
          return;
        }
        // Local testing: in-memory coordination
        const pending = pendingWaits.get("pending");
        if (!pending) {
          throw new Error(`No pending wait for key "${key}"`);
        }
        const result = await callback(pending.payload);
        pending.resolve(result ? JSON.parse(JSON.stringify(result)) : result);
        pendingWaits.delete("pending");
      },
    } satisfies WaitPointInstance<unknown, unknown>,
    "wait-point",
  );

  // Internal hook for defineWaitPoints to set the correct key after construction.
  Object.defineProperty(instance, SET_KEY, {
    value: (k: string) => {
      key = k;
    },
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return instance;
}

/**
 * The `define` function passed to the `defineWaitPoints` builder callback.
 * Returns an actual WaitPointInstance (not a phantom marker) so that the
 * builder's return type can flow through as-is, preserving JSDoc comments
 * on each property for IDE autocompletion.
 */
type DefineFn = <Payload = undefined, Result = undefined>() => WaitPointInstance<Payload, Result>;

/**
 * Define a group of typed wait points for human-in-the-loop workflows.
 * Property names become the wait point keys.
 *
 * The return type is the same as the builder's return type, so JSDoc on each
 * property is preserved and visible in IDE autocompletion.
 * @param builder - Callback that receives a `define` factory and returns an object of wait points
 * @returns The same object returned by the builder (with correct keys set on each instance)
 * @example
 * export const waitPoints = defineWaitPoints(define => ({
 *   /&#42;&#42; Approval for order processing &#42;/
 *   approval: define<{ message: string }, { approved: boolean }>(),
 * }));
 *
 * // IDE shows the JSDoc when typing `waitPoints.`
 * await waitPoints.approval.wait({ message: "Please approve" });
 *
 * // For 2-level access, use destructured export with explicit JSDoc on the export:
 * /&#42;&#42; Approval for order processing &#42;/
 * export const { approval } = waitPoints;
 */
// oxlint-disable-next-line no-explicit-any
export function defineWaitPoints<T extends Record<string, WaitPointInstance<any, any>>>(
  builder: (define: DefineFn) => T,
): T {
  const define: DefineFn = <Payload, Result>() =>
    createWaitPointInstance("__pending__") as unknown as WaitPointInstance<Payload, Result>;

  const result = builder(define);

  // Set the correct key on each instance based on the property name
  for (const key of Object.keys(result)) {
    const instance = result[key] as WaitPointInternals;
    instance[SET_KEY]?.(key);
  }

  return result;
}
