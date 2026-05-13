/**
 * Execution context utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.context` runtime API.
 * At runtime this delegates to `globalThis.tailor.context`. Use
 * `setupInvokerMock` from `@tailor-platform/sdk/test` to mock in unit tests.
 * @example
 * import { context } from "@tailor-platform/sdk/runtime";
 *
 * const invoker = context.getInvoker();
 * if (invoker) {
 *   console.log(invoker.id, invoker.type);
 * }
 */

import { runtime, type ContextInvoker } from "./_runtime";

/** Information about the invoker of the current function execution. */
export type Invoker = ContextInvoker;

/**
 * Returns information about the invoker of the current function execution,
 * or `null` for anonymous invocations.
 * @returns Invoker details, or `null` when the call is anonymous
 */
export function getInvoker(): Invoker | null {
  return runtime.tailor.context.getInvoker();
}
