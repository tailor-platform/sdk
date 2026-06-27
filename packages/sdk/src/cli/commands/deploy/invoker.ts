import type { AuthInvoker } from "#/types/auth.generated";

/**
 * Normalize an invoker value to the object form required by the proto payload.
 *
 * Accepts either:
 * - `undefined` — returns undefined
 * - a plain string (machine user name) — expands to `{ namespace, machineUserName }` using `authNamespace`
 * - an internal object `{ namespace, machineUserName }` — returned as-is
 * @param invoker - String machine user name or internal object form
 * @param authNamespace - Auth service namespace (required when invoker is a string)
 * @param context - Contextual label used in error messages (e.g. `resolver "foo"`)
 * @returns Object form of the invoker, or undefined
 */
export function normalizeInvoker(
  invoker: string | AuthInvoker | undefined,
  authNamespace: string | undefined,
  context: string,
): { namespace: string; machineUserName: string } | undefined {
  if (invoker === undefined) return undefined;
  if (typeof invoker === "string") {
    if (!authNamespace) {
      throw new Error(
        `${context} uses a string invoker ("${invoker}"), but no Auth service is configured. ` +
          `Configure an Auth service before using invoker.`,
      );
    }
    return { namespace: authNamespace, machineUserName: invoker };
  }
  return invoker;
}
