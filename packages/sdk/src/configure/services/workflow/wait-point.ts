import { brandValue } from "#/utils/brand";
import type { TailorWorkflowAPI } from "#/runtime/workflow";
import type { JsonCompatible } from "#/types/helpers";

/**
 * A single wait point instance with typed `.wait()` and `.resolve()` methods.
 *
 * - `.wait(payload?)` suspends execution until resolved. Returns the result from `.resolve()`.
 * - `.resolve(executionId, callback)` resumes a suspended execution.
 *
 * Both `Payload` and `Result` must be JsonValue-compatible (primitives, plain objects, arrays).
 * Functions and objects with a `toJSON` method are rejected at the type level.
 */
export interface WaitPointInstance<Payload = undefined, Result = undefined> {
  wait: [Payload] extends [undefined]
    ? () => Promise<Result>
    : (payload: Payload) => Promise<Result>;
  resolve: (
    executionId: string,
    callback: (
      payload: [Payload] extends [undefined] ? undefined : Payload,
    ) => Result | Promise<Result>,
  ) => Promise<void>;
}

interface InternalWaitPointInstance {
  wait: (payload?: unknown) => Promise<unknown>;
  resolve: (
    executionId: string,
    callback: (payload: unknown) => unknown | Promise<unknown>,
  ) => Promise<void>;
}

interface WaitPointWithSetter {
  instance: InternalWaitPointInstance;
  setKey: (key: string) => void;
}

function getPlatformWorkflow() {
  const platform = globalThis as { tailor?: { workflow?: TailorWorkflowAPI } };
  const workflow = platform.tailor?.workflow;
  if (!workflow) {
    throw new Error(
      "tailor.workflow is not available. Run tests in the `tailor-runtime` Vitest environment, " +
        "or acquire mockWorkflow() from @tailor-platform/sdk/vitest and set a wait/resolve handler.",
    );
  }
  return workflow;
}

/**
 * Create a WaitPointInstance that delegates to the platform runtime.
 * Use `mockWorkflow` from `@tailor-platform/sdk/vitest` to mock
 * `globalThis.tailor.workflow.wait/resolve` in tests.
 * @param initialKey - Initial key (can be updated via the returned setter)
 * @returns The instance and a setter to update the key after construction
 */
function createWaitPointInstance(initialKey: string): WaitPointWithSetter {
  let key = initialKey;

  const instance = brandValue(
    {
      wait(payload?: unknown) {
        return Promise.resolve(getPlatformWorkflow().wait(key, payload));
      },
      async resolve(executionId: string, callback: (p: unknown) => unknown | Promise<unknown>) {
        await getPlatformWorkflow().resolve(executionId, key, callback);
      },
    },
    "wait-point",
  ) as InternalWaitPointInstance;

  return {
    instance,
    setKey: (k: string) => {
      key = k;
    },
  };
}

/**
 * The type produced by `define<Payload, Result>()` / `defineWaitPoint<Payload, Result>(key)`.
 * Resolves to `WaitPointInstance<Payload, Result>` when both types are JsonValue-compatible,
 * or to a template-literal error string that surfaces at the call site.
 */
type WaitPointDef<Payload, Result> = [null] extends [Payload]
  ? "ERROR: Payload cannot be null at the top level"
  : [undefined] extends [Result]
    ? "ERROR: Result cannot be (or include) undefined (resolve callback must return a value)"
    : [Payload] extends [undefined]
      ? [Result] extends [JsonCompatible<Result>]
        ? WaitPointInstance<Payload, Result>
        : "ERROR: Result must be JsonValue-compatible (plain objects/arrays; no class instances or functions)"
      : [undefined] extends [Payload]
        ? "ERROR: Payload cannot include undefined at the top level"
        : [Payload] extends [JsonCompatible<Payload>]
          ? [Result] extends [JsonCompatible<Result>]
            ? WaitPointInstance<Payload, Result>
            : "ERROR: Result must be JsonValue-compatible (plain objects/arrays; no class instances or functions)"
          : "ERROR: Payload must be JsonValue-compatible (plain objects/arrays; no class instances or functions)";

/**
 * The `define` function passed to the `defineWaitPoints` builder callback.
 * Returns an actual WaitPointInstance (not a phantom marker) so that the
 * builder's return type can flow through as-is, preserving JSDoc comments
 * on each property for IDE autocompletion.
 *
 * JSON validation is encoded in the return type rather than in type-parameter
 * constraints, because tsgo rejects self-referential constraints like
 * `Payload extends JsonCompatible<Payload>` as circular.
 */
type DefineFn = <Payload = undefined, Result = undefined>() => WaitPointDef<Payload, Result>;

/**
 * Define a single typed wait point with an explicit key.
 *
 * `Payload` and `Result` must be JsonValue-compatible.
 * Functions and objects with a `toJSON` method are rejected at the type level;
 * class instances exposing methods are rejected via the property walk.
 * @param key - The wait point key used to match wait and resolve calls
 * @returns A WaitPointInstance with typed `.wait()` and `.resolve()` methods
 * @example
 * export const approval = defineWaitPoint<{ message: string }, { approved: boolean }>("approval");
 *
 * await approval.wait({ message: "Please approve" });
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineWaitPoint<Payload = undefined, Result = undefined>(
  key: string,
): WaitPointDef<Payload, Result> {
  return createWaitPointInstance(key).instance as unknown as WaitPointDef<Payload, Result>;
}

/**
 * Define a group of typed wait points for human-in-the-loop workflows.
 * Property names become the wait point keys.
 *
 * The return type is the same as the builder's return type, so JSDoc on each
 * property is preserved and visible in IDE autocompletion.
 *
 * `Payload` and `Result` must be JsonValue-compatible.
 * Functions and objects with a `toJSON` method are rejected at the type level;
 * class instances exposing methods are rejected via the property walk.
 * @param builder - Callback that receives a `define` factory and returns an object of wait points
 * @returns The same object returned by the builder (with correct keys set on each instance)
 * @example
 * export const waitPoints = defineWaitPoints(define => ({
 *   // Preceding JSDoc on this property is shown in IDE autocompletion
 *   approval: define<{ message: string }, { approved: boolean }>(),
 * }));
 *
 * // IDE shows the JSDoc when typing `waitPoints.`
 * await waitPoints.approval.wait({ message: "Please approve" });
 *
 * // For 2-level access, use destructured export with JSDoc attached to the export itself.
 */
/* @__NO_SIDE_EFFECTS__ */
// oxlint-disable-next-line no-explicit-any
export function defineWaitPoints<T extends Record<string, WaitPointInstance<any, any>>>(
  builder: (define: DefineFn) => T,
): T {
  const setters = new Map<InternalWaitPointInstance, (key: string) => void>();

  const define = (<Payload, Result>() => {
    const { instance, setKey } = createWaitPointInstance("__pending__");
    setters.set(instance, setKey);
    return instance as unknown as WaitPointDef<Payload, Result>;
  }) as DefineFn;

  const result = builder(define);

  // Set the correct key on each instance based on the property name
  for (const key of Object.keys(result)) {
    const setter = setters.get(result[key] as unknown as InternalWaitPointInstance);
    setter?.(key);
  }

  return result;
}
