import { fetchAll, isNotFoundError, type OperatorClient } from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import type { AuthInvoker } from "#/types/auth.generated";

/**
 * Machine users that each Auth namespace an invoker names has after the deploy, by namespace;
 * `null` for a namespace the workspace does not have and no config in the run defines.
 */
export type InvokerMachineUsers = ReadonlyMap<string, ReadonlySet<string> | null>;

/**
 * Normalize an invoker value to the object form required by the proto payload.
 *
 * Accepts either:
 * - `undefined` — returns undefined
 * - a plain string (machine user name) — expands to `{ namespace, machineUserName }` with the
 *   config's Auth namespace, or with the one of several that defines the machine user
 * - an object `{ namespace, machineUserName }` — returned as-is
 * @param invoker - String machine user name or object form
 * @param authNamespaces - Auth namespaces of the config (at least one when invoker is a string)
 * @param context - Contextual label used in error messages (e.g. `resolver "foo"`)
 * @param machineUsers - Machine users of each Auth namespace the invokers name; an invoker whose namespace lacks the machine user, or whose namespace does not exist (`null`), is rejected. Pass undefined to skip the check
 * @returns Object form of the invoker, or undefined
 */
export function normalizeInvoker(
  invoker: string | AuthInvoker | undefined,
  authNamespaces: ReadonlyArray<string>,
  context: string,
  machineUsers: InvokerMachineUsers | undefined,
): AuthInvoker | undefined {
  if (invoker === undefined) return undefined;
  const resolved = resolveInvoker({ invoker, authNamespaces, context, machineUsers });
  if (machineUsers) assertInvokerMachineUser(resolved, context, machineUsers);
  return resolved;
}

type ResolveInvokerParams = {
  invoker: string | AuthInvoker;
  authNamespaces: ReadonlyArray<string>;
  context: string;
  machineUsers: InvokerMachineUsers | undefined;
};

function resolveInvoker(params: ResolveInvokerParams): AuthInvoker {
  const { invoker, authNamespaces, context, machineUsers } = params;
  if (typeof invoker !== "string") return invoker;
  const [only, ...others] = authNamespaces;
  if (only === undefined) {
    throw CLIError({
      code: "INVOKER_AUTH_REQUIRED",
      message: `${context} uses a string invoker ("${invoker}"), but no Auth service is configured.`,
      suggestion: "Configure an Auth service before using invoker.",
    });
  }
  if (others.length === 0) return { namespace: only, machineUserName: invoker };
  if (!machineUsers) {
    throw internalError(`Machine users are needed to resolve invoker "${invoker}"`);
  }
  const defining = authNamespaces.filter((namespace) => machineUsers.get(namespace)?.has(invoker));
  const [namespace, ...alsoDefining] = defining;
  if (namespace === undefined) {
    const names = [
      ...new Set(authNamespaces.flatMap((name) => [...(machineUsers.get(name) ?? [])])),
    ].toSorted();
    throw CLIError({
      code: "INVOKER_MACHINE_USER_NOT_FOUND",
      message: `${context} uses invoker "${invoker}", but none of the Auth services ${authNamespaces.join(", ")} has a machine user with that name.`,
      suggestion: names.length
        ? `Use one of the existing machine users: ${names.join(", ")}.`
        : "Define the machine user in one of these Auth services before using it as invoker.",
      context: { invoker, authNamespaces: [...authNamespaces], machineUsers: names },
    });
  }
  if (alsoDefining.length > 0) {
    throw CLIError({
      code: "INVOKER_MACHINE_USER_AMBIGUOUS",
      message: `${context} uses invoker "${invoker}", which the Auth services ${defining.join(", ")} all define.`,
      suggestion: `Name the Auth service, for example invoker: { namespace: "${namespace}", machineUserName: "${invoker}" }.`,
      context: { invoker, authNamespaces: defining },
    });
  }
  return { namespace, machineUserName: invoker };
}

function assertInvokerMachineUser(
  invoker: AuthInvoker,
  context: string,
  machineUsers: InvokerMachineUsers,
): void {
  const { namespace: authNamespace, machineUserName } = invoker;
  const known = machineUsers.get(authNamespace);
  if (known === undefined) {
    throw internalError(`Machine users of Auth namespace "${authNamespace}" were not listed`);
  }
  if (known === null) {
    throw CLIError({
      code: "INVOKER_AUTH_NOT_FOUND",
      message: `${context} uses invoker "${machineUserName}" of Auth service "${authNamespace}", but the workspace has no Auth service with that name.`,
      suggestion: `Name an existing Auth service, or deploy the config that defines "${authNamespace}" first or in the same run.`,
      context: { invoker: machineUserName, authNamespace },
    });
  }
  if (known.has(machineUserName)) return;
  const names = [...known].toSorted();
  throw CLIError({
    code: "INVOKER_MACHINE_USER_NOT_FOUND",
    message: `${context} uses invoker "${machineUserName}", but Auth service "${authNamespace}" has no machine user with that name.`,
    suggestion: names.length
      ? `Use one of the existing machine users: ${names.join(", ")}.`
      : `Define the machine user in Auth service "${authNamespace}" before using it as invoker.`,
    context: { invoker: machineUserName, authNamespace, machineUsers: names },
  });
}

type ListInvokerMachineUsersParams = {
  client: OperatorClient;
  workspaceId: string;
  /** Invokers whose Auth namespaces to list. */
  invokers: Iterable<string | AuthInvoker | undefined>;
  /** Auth namespaces of the config, which string invokers refer to. */
  authNamespaces: ReadonlyArray<string>;
  /** Machine users that each Auth namespace has after this deploy run, for the namespaces a config in the run defines. */
  plannedMachineUsers?: ReadonlyMap<string, ReadonlySet<string>>;
};

/**
 * List the machine users of each Auth namespace that the invokers name.
 * When a config in the deploy run defines the Auth namespace, the machine users it lists are the final set,
 * because the deploy deletes the ones it no longer lists. Otherwise the workspace's machine users are used.
 * @param params - Client, workspace, invokers, Auth namespaces of string invokers, and machine users the deploy run defines
 * @returns Machine users by Auth namespace, or undefined when no invoker names an Auth namespace
 */
export async function listInvokerMachineUsers(
  params: ListInvokerMachineUsersParams,
): Promise<InvokerMachineUsers | undefined> {
  const { client, workspaceId, invokers, authNamespaces, plannedMachineUsers } = params;
  const namespaces = new Set<string>();
  for (const invoker of invokers) {
    if (invoker === undefined) continue;
    if (typeof invoker !== "string") namespaces.add(invoker.namespace);
    else for (const namespace of authNamespaces) namespaces.add(namespace);
  }
  if (namespaces.size === 0) return undefined;
  return new Map(
    await Promise.all(
      [...namespaces].map(
        async (namespace) =>
          [
            namespace,
            plannedMachineUsers?.get(namespace) ??
              (await listWorkspaceMachineUsers(client, workspaceId, namespace)),
          ] as const,
      ),
    ),
  );
}

async function listWorkspaceMachineUsers(
  client: OperatorClient,
  workspaceId: string,
  authNamespace: string,
): Promise<ReadonlySet<string> | null> {
  try {
    const machineUsers = await fetchAll(async (pageToken, pageSize) => {
      const response = await client.listAuthMachineUsers({
        workspaceId,
        authNamespace,
        pageToken,
        pageSize,
      });
      return [response.machineUsers, response.nextPageToken];
    });
    return new Set(machineUsers.map((machineUser) => machineUser.name));
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}
