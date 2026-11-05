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
 * @param knownMachineUsers - Machine user names that exist in `authNamespace`; when given, a string invoker outside it is rejected
 * @returns Object form of the invoker, or undefined
 */
export function normalizeInvoker(
  invoker: string | AuthInvoker | undefined,
  authNamespace: string | undefined,
  context: string,
  knownMachineUsers?: ReadonlySet<string>,
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

type ListKnownMachineUsersParams = {
  client: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  /** Machine users that this deploy creates, which do not exist in the workspace yet. */
  plannedMachineUsers?: Iterable<string>;
};

/**
 * List the machine user names a string invoker may refer to in an auth namespace.
 * @param params - Workspace, auth namespace, and machine users planned by the current deploy
 * @returns Names of machine users in the workspace plus the planned ones
 */
export async function listKnownMachineUsers(
  params: ListKnownMachineUsersParams,
): Promise<ReadonlySet<string>> {
  const { client, workspaceId, authNamespace, plannedMachineUsers = [] } = params;
  const existing = await listAuthMachineUsersTolerant(client, workspaceId, authNamespace);
  return new Set([...existing.map((machineUser) => machineUser.name), ...plannedMachineUsers]);
}

type ListInvokerMachineUsersParams = {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  /** Machine user names that every config in the deploy run defines, keyed by Auth namespace. */
  plannedMachineUsers?: ReadonlyMap<string, ReadonlySet<string>>;
};

/**
 * List the machine users a string invoker of an application may refer to.
 * @param params - Client, workspace, application, and machine users planned by the deploy run
 * @returns Known machine user names, or undefined when the application has no Auth namespace
 */
export async function listInvokerMachineUsers(
  params: ListInvokerMachineUsersParams,
): Promise<ReadonlySet<string> | undefined> {
  const { client, workspaceId, application, plannedMachineUsers } = params;
  const authNamespace = getApplicationAuthNamespace(application);
  if (!authNamespace) return undefined;
  return listKnownMachineUsers({
    client,
    workspaceId,
    authNamespace,
    plannedMachineUsers: [
      ...Object.keys(application.authService?.config.machineUsers ?? {}),
      ...(plannedMachineUsers?.get(authNamespace) ?? []),
    ],
  });
}
