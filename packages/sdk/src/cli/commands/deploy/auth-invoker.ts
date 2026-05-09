import type { AuthInvoker } from "@/types/auth.generated";

/**
 * Normalize an authInvoker value to the object form required by the proto payload.
 *
 * Accepts either:
 * - `undefined` — returns undefined
 * - a plain string (machine user name) — expands to `{ namespace, machineUserName }` using `authNamespace`
 * - an object `{ namespace, machineUserName }` — returned as-is
 * @param authInvoker - String machine user name or object form
 * @param authNamespace - Auth service namespace (required when authInvoker is a string)
 * @param context - Contextual label used in error messages (e.g. `resolver "foo"`)
 * @returns Object form of auth invoker, or undefined
 */
export function normalizeAuthInvoker(
  authInvoker: string | AuthInvoker | undefined,
  authNamespace: string | undefined,
  context: string,
): { namespace: string; machineUserName: string } | undefined {
  if (authInvoker === undefined) return undefined;
  if (typeof authInvoker === "string") {
    if (!authNamespace) {
      throw new Error(
        `${context} uses a string authInvoker ("${authInvoker}"), but no Auth service is configured. ` +
          `Configure an Auth service or use the object form { namespace, machineUserName }.`,
      );
    }
    return { namespace: authNamespace, machineUserName: authInvoker };
  }
  return authInvoker;
}
