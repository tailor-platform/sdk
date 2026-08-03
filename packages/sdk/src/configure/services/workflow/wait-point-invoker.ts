import type { PlatformWorkflowAPI } from "#/runtime/workflow";

// Not re-exported from the workflow barrel: the slot exists so the Vitest mock
// can intercept parameterized wait points, whose `wait`/`resolve` live on
// short-lived objects returned by `.with()` rather than on the definition.
const WAIT_POINT_INVOKER: unique symbol = Symbol.for("tailor-platform/sdk:wait-point-invoker");
const WAIT_POINT_KEY: unique symbol = Symbol.for("tailor-platform/sdk:wait-point-key");

/** Indirection every wait point call routes through, keyed by resolved key. */
export interface WaitPointInvoker {
  wait(key: string, payload: unknown): unknown;
  resolve(
    key: string,
    executionId: string,
    callback: (payload: unknown) => unknown | Promise<unknown>,
  ): Promise<void>;
}

function getPlatformWorkflow(): PlatformWorkflowAPI {
  const platform = globalThis as { tailor?: { workflow?: PlatformWorkflowAPI } };
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
 * Create the invoker a single wait point definition delegates to.
 * @returns An invoker bound to the platform runtime
 */
export function createWaitPointInvoker(): WaitPointInvoker {
  return {
    wait(key, payload) {
      return getPlatformWorkflow().wait(key, payload);
    },
    async resolve(key, executionId, callback) {
      await getPlatformWorkflow().resolve(executionId, key, callback);
    },
  };
}

/**
 * Attach an invoker to a wait point definition so test doubles can intercept it.
 *
 * The slot itself is fixed once attached; a double swaps the invoker's `wait` /
 * `resolve` methods rather than the invoker object.
 * @param target - Wait point definition to attach to
 * @param invoker - Invoker the definition delegates to
 * @returns The same definition
 */
export function attachWaitPointInvoker<T extends object>(target: T, invoker: WaitPointInvoker): T {
  Object.defineProperty(target, WAIT_POINT_INVOKER, {
    value: invoker,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return target;
}

/**
 * Read the invoker attached to a wait point definition.
 * @param target - Wait point definition to read from
 * @returns The attached invoker, or undefined when the value is not a wait point
 */
export function getWaitPointInvoker(target: object): WaitPointInvoker | undefined {
  return (target as Record<symbol, WaitPointInvoker | undefined>)[WAIT_POINT_INVOKER];
}

/**
 * Record the resolved key on a wait point bound by `.with()`.
 * @param target - Bound wait point to attach to
 * @param key - Resolved runtime key
 * @returns The same bound wait point
 */
export function attachWaitPointKey<T extends object>(target: T, key: string): T {
  Object.defineProperty(target, WAIT_POINT_KEY, {
    value: key,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return target;
}

/**
 * Read the resolved key recorded on a bound wait point.
 * @param target - Bound wait point to read from
 * @returns The resolved key, or undefined when the value is not a bound wait point
 */
export function getWaitPointKey(target: object): string | undefined {
  return (target as Record<symbol, string | undefined>)[WAIT_POINT_KEY];
}
