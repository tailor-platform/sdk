import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { listAuthMachineUsersTolerant, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import type { Application } from "#/cli/services/application";
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
 * @param knownMachineUsers - Machine user names that `authNamespace` has after the deploy; a string invoker outside it is rejected. Pass undefined to skip the check
 * @returns Object form of the invoker, or undefined
 */
export function normalizeInvoker(
  invoker: string | AuthInvoker | undefined,
  authNamespace: string | undefined,
  context: string,
  knownMachineUsers: ReadonlySet<string> | undefined,
): { namespace: string; machineUserName: string } | undefined {
  if (invoker === undefined) return undefined;
  if (typeof invoker === "string") {
    if (!authNamespace) {
      throw CLIError({
        code: "INVOKER_AUTH_REQUIRED",
        message: `${context} uses a string invoker ("${invoker}"), but no Auth service is configured.`,
        suggestion: "Configure an Auth service before using invoker.",
      });
    }
    if (knownMachineUsers && !knownMachineUsers.has(invoker)) {
      const machineUsers = [...knownMachineUsers].toSorted();
      throw CLIError({
        code: "INVOKER_MACHINE_USER_NOT_FOUND",
        message: `${context} uses invoker "${invoker}", but Auth service "${authNamespace}" has no machine user with that name.`,
        suggestion: machineUsers.length
          ? `Use one of the existing machine users: ${machineUsers.join(", ")}.`
          : `Define the machine user in Auth service "${authNamespace}" before using it as invoker.`,
        context: { invoker, authNamespace, machineUsers },
      });
    }
    return { namespace: authNamespace, machineUserName: invoker };
  }
  return invoker;
}

type ListInvokerMachineUsersParams = {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  /** Machine users that each Auth namespace has after this deploy run, for the namespaces a config in the run defines. */
  plannedMachineUsers?: ReadonlyMap<string, ReadonlySet<string>>;
};

/**
 * List the machine users a string invoker of an application may refer to.
 * When a config in the deploy run defines the Auth namespace, the machine users it lists are the final set,
 * because the deploy deletes the ones it no longer lists. Otherwise the workspace's machine users are used.
 * @param params - Client, workspace, application, and machine users the deploy run defines
 * @returns Known machine user names, or undefined when the application has no Auth namespace
 */
export async function listInvokerMachineUsers(
  params: ListInvokerMachineUsersParams,
): Promise<ReadonlySet<string> | undefined> {
  const { client, workspaceId, application, plannedMachineUsers } = params;
  const authNamespace = getApplicationAuthNamespace(application);
  if (!authNamespace) return undefined;
  const planned = plannedMachineUsers?.get(authNamespace);
  if (planned) return planned;
  const existing = await listAuthMachineUsersTolerant(client, workspaceId, authNamespace);
  return new Set(existing.map((machineUser) => machineUser.name));
}
