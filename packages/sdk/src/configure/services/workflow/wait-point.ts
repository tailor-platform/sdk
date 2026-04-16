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

interface WaitPointWithSetter<Payload, Result> {
  instance: WaitPointInstance<Payload, Result>;
  setKey: (key: string) => void;
}

/**
 * Create a WaitPointInstance with in-memory coordination for local testing.
 * @param initialKey - Initial key (used in error messages until updated)
 * @returns The instance and a setter to update the key after construction
 */
function createWaitPointInstance<Payload = undefined, Result = undefined>(
  initialKey: string,
): WaitPointWithSetter<Payload, Result> {
  let key = initialKey;
  const pendingWaits = new Map<string, { payload: Payload; resolve: (result: Result) => void }>();

  const instance = brandValue(
    {
      wait(payload?: Payload) {
        const platformWait = (
          globalThis as {
            tailor?: { workflow?: { wait?: (k: string, p?: Payload) => Result } };
          }
        ).tailor?.workflow?.wait;
        if (platformWait) {
          return Promise.resolve(platformWait(key, payload)) as Promise<Result>;
        }
        return new Promise<Result>((resolve) => {
          pendingWaits.set("pending", { payload: payload as Payload, resolve });
        });
      },
      async resolve(executionId: string, callback: (p: Payload) => Result | Promise<Result>) {
        const platformResolve = (
          globalThis as {
            tailor?: {
              workflow?: {
                resolve?: (
                  e: string,
                  k: string,
                  c: (p: Payload) => Result | Promise<Result>,
                ) => Promise<void>;
              };
            };
          }
        ).tailor?.workflow?.resolve;
        if (platformResolve) {
          await platformResolve(executionId, key, callback);
          return;
        }
        const pending = pendingWaits.get("pending");
        if (!pending) {
          throw new Error(`No pending wait for key "${key}"`);
        }
        const result = await callback(pending.payload);
        pending.resolve(result ? JSON.parse(JSON.stringify(result)) : result);
        pendingWaits.delete("pending");
      },
    },
    "wait-point",
  ) as unknown as WaitPointInstance<Payload, Result>;

  return {
    instance,
    setKey: (k: string) => {
      key = k;
    },
  };
}

/**
 * The `define` function passed to the `defineWaitPoints` builder callback.
 * Returns an actual WaitPointInstance (not a phantom marker) so that the
 * builder's return type can flow through as-is, preserving JSDoc comments
 * on each property for IDE autocompletion.
 */
type DefineFn = <Payload = undefined, Result = undefined>() => WaitPointInstance<Payload, Result>;

/**
 * Define a single typed wait point with an explicit key.
 * @param key - The wait point key used to match wait and resolve calls
 * @returns A WaitPointInstance with typed `.wait()` and `.resolve()` methods
 * @example
 * export const approval = defineWaitPoint<{ message: string }, { approved: boolean }>("approval");
 *
 * await approval.wait({ message: "Please approve" });
 */
export function defineWaitPoint<Payload = undefined, Result = undefined>(
  key: string,
): WaitPointInstance<Payload, Result> {
  return createWaitPointInstance<Payload, Result>(key).instance;
}

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
  // oxlint-disable-next-line no-explicit-any
  const setters = new Map<WaitPointInstance<any, any>, (key: string) => void>();

  const define: DefineFn = <Payload, Result>() => {
    const { instance, setKey } = createWaitPointInstance<Payload, Result>("__pending__");
    setters.set(instance, setKey);
    return instance;
  };

  const result = builder(define);

  // Set the correct key on each instance based on the property name
  for (const key of Object.keys(result)) {
    const setter = setters.get(result[key]);
    setter?.(key);
  }

  return result;
}
