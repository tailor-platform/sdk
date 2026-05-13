/**
 * Execution context utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.context` runtime API.
 * At runtime this delegates to `globalThis.tailor.context`. Use `contextMock`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 * @example
 * import { context } from "@tailor-platform/sdk/runtime";
 *
 * const invoker = context.getInvoker();
 * if (invoker) {
 *   console.log(invoker.id, invoker.type, invoker.attributes, invoker.attributeList);
 * }
 */

import { runtime } from "./_runtime";

/**
 * Information about the invoker of the current function execution.
 *
 * Matches the shape of `TailorUser` and `TailorActor` — `attributes` is the
 * attribute map and `attributeList` is the array of attribute IDs.
 */
export interface Invoker {
  /** The invoker's ID */
  id: string;
  /** The invoker's type */
  type: "user" | "machine_user";
  /** The workspace ID */
  workspaceId: string;
  /** A map of the invoker's attributes */
  attributes: Record<string, unknown>;
  /** The list of attribute IDs */
  attributeList: string[];
}

/**
 * Returns information about the invoker of the current function execution,
 * or `null` for anonymous invocations.
 * @returns Invoker details, or `null` when the call is anonymous
 */
export function getInvoker(): Invoker | null {
  const raw = runtime.tailor.context.getInvoker();
  if (!raw) return null;
  return {
    id: raw.id,
    type: raw.type,
    workspaceId: raw.workspaceId,
    attributes: raw.attributeMap,
    attributeList: raw.attributes,
  };
}
