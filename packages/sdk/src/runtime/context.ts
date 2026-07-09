/**
 * Execution context utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.context` runtime API.
 * At runtime this delegates to `globalThis.tailor.context`.
 * @example
 * import { context } from "@tailor-platform/sdk/runtime";
 *
 * const invoker = context.getInvoker();
 * if (invoker) {
 *   console.log(invoker.id, invoker.type, invoker.attributes, invoker.attributeList);
 * }
 */

import type { TailorPrincipal } from "#/runtime/types";

/**
 * Information about the invoker of the current function execution.
 *
 * Matches the public `TailorPrincipal` shape — `attributes` is the attribute
 * map and `attributeList` is the array of attribute IDs.
 */
export type Invoker = TailorPrincipal;

/**
 * Raw platform-side invoker payload returned by `tailor.context.getInvoker()`.
 * The wrapper normalizes this into {@link Invoker}.
 * @internal
 */
export interface ContextInvoker {
  /** The invoker's ID */
  id: string;
  /** The invoker's type */
  type: "user" | "machine_user";
  /** The workspace ID */
  workspaceId: string;
  /** The invoker's attribute IDs */
  attributes: string[];
  /** The invoker's attribute map */
  attributeMap: Record<string, unknown>;
}

/**
 * Platform API surface for `tailor.context`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.context`.
 * @internal
 */
export interface TailorContextAPI {
  getInvoker(): ContextInvoker | null;
}

/**
 * Returns information about the invoker of the current function execution,
 * or `null` for anonymous invocations.
 * @returns Invoker details, or `null` when the call is anonymous
 */
export function getInvoker(): Invoker | null {
  const raw = (globalThis as { tailor: { context: TailorContextAPI } }).tailor.context.getInvoker();
  if (!raw) return null;
  return {
    id: raw.id,
    type: raw.type,
    workspaceId: raw.workspaceId,
    attributes: raw.attributeMap as Invoker["attributes"],
    attributeList: raw.attributes as Invoker["attributeList"],
  };
}
