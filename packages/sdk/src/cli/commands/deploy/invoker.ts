import { fetchAll, isNotFoundError, type OperatorClient } from "#/cli/shared/client";
import { internalError, locatedCLIError } from "#/cli/shared/errors";
import { authNamespacesDefining } from "#/cli/shared/machine-user";
import { configAuthNamespaces } from "./deploy-application";
import type { AuthInvoker } from "#/types/auth.generated";
import type { PlanContext } from "./types";

/**
 * Machine users that each Auth namespace an invoker names has after the deploy, by namespace;
 * `null` for a namespace the workspace does not have and no config in the run defines.
 */
export type InvokerMachineUsers = ReadonlyMap<string, ReadonlySet<string> | null>;

/** An executor or resolver that a deploy plans, and the file that defines it. */
export type DefinitionRef = {
  kind: "executor" | "resolver";
  name: string;
  /** Absolute path of the file that defines it. */
  file: string;
};

/** What the invokers of one config resolve against. */
export type InvokerScope = {
  /** Auth namespaces of the config; a string invoker needs at least one. */
  authNamespaces: ReadonlyArray<string>;
  /** Machine users of each Auth namespace the invokers name; an invoker whose namespace lacks the machine user, or whose namespace does not exist (`null`), is rejected. Undefined skips the check. */
  machineUsers: InvokerMachineUsers | undefined;
  /** Absolute path of the config file, which names the Auth namespaces. */
  configPath: string;
};

function definitionLabel(definition: DefinitionRef): string {
  return `${definition.kind === "executor" ? "Executor" : "Resolver"} "${definition.name}"`;
}

function definitionContext(definition: DefinitionRef): Record<string, string> {
  return { [definition.kind]: definition.name };
}

/**
 * Normalize an invoker value to the object form required by the proto payload.
 *
 * Accepts either:
 * - `undefined` — returns undefined
 * - a plain string (machine user name) — expands to `{ namespace, machineUserName }` with the
 *   config's Auth namespace, or with the one of several that defines the machine user
 * - an object `{ namespace, machineUserName }` — returned as-is
 * @param invoker - String machine user name or object form
 * @param scope - Auth namespaces, machine users, and config file the invoker resolves against
 * @param definition - Executor or resolver whose invoker this is
 * @returns Object form of the invoker, or undefined
 */
export function normalizeInvoker(
  invoker: string | AuthInvoker | undefined,
  scope: InvokerScope,
  definition: DefinitionRef,
): AuthInvoker | undefined {
  if (invoker === undefined) return undefined;
  const resolved = resolveInvoker({ invoker, scope, definition });
  if (scope.machineUsers) {
    assertInvokerMachineUser({
      invoker: resolved,
      namespaceFile: typeof invoker === "string" ? scope.configPath : definition.file,
      definition,
      machineUsers: scope.machineUsers,
    });
  }
  return resolved;
}

type ResolveInvokerParams = {
  invoker: string | AuthInvoker;
  scope: InvokerScope;
  definition: DefinitionRef;
};

function resolveInvoker(params: ResolveInvokerParams): AuthInvoker {
  const {
    invoker,
    scope: { authNamespaces, machineUsers },
    definition,
  } = params;
  if (typeof invoker !== "string") return invoker;
  const label = definitionLabel(definition);
  const [only, ...others] = authNamespaces;
  if (only === undefined) {
    throw locatedCLIError(
      { file: definition.file },
      {
        code: "INVOKER_AUTH_REQUIRED",
        message: `${label} uses a string invoker ("${invoker}"), but no Auth service is configured.`,
        suggestion: `Name the Auth service that defines the machine user: invoker: { namespace: "<auth>", machineUserName: ${JSON.stringify(invoker)} }, or configure an Auth service.`,
        context: { invoker, ...definitionContext(definition) },
      },
    );
  }
  if (others.length === 0) return { namespace: only, machineUserName: invoker };
  if (!machineUsers) {
    throw internalError(`Machine users are needed to resolve invoker "${invoker}"`);
  }
  const defining = authNamespacesDefining(
    invoker,
    authNamespaces.map((name) => ({ name, machineUsers: [...(machineUsers.get(name) ?? [])] })),
  );
  const [namespace, ...alsoDefining] = defining;
  if (namespace === undefined) {
    const names = [
      ...new Set(authNamespaces.flatMap((name) => [...(machineUsers.get(name) ?? [])])),
    ].toSorted();
    throw locatedCLIError(
      { file: definition.file },
      {
        code: "INVOKER_MACHINE_USER_NOT_FOUND",
        message: `${label} uses invoker "${invoker}", but none of the Auth services ${authNamespaces.join(", ")} has a machine user with that name.`,
        suggestion: names.length
          ? `Use one of the existing machine users: ${names.join(", ")}.`
          : "Define the machine user in one of these Auth services before using it as invoker.",
        context: {
          invoker,
          authNamespaces: [...authNamespaces],
          machineUsers: names,
          ...definitionContext(definition),
        },
      },
    );
  }
  if (alsoDefining.length > 0) {
    throw locatedCLIError(
      { file: definition.file },
      {
        code: "INVOKER_MACHINE_USER_AMBIGUOUS",
        message: `${label} uses invoker "${invoker}", which the Auth services ${defining.join(", ")} all define.`,
        suggestion: `Name the Auth service, for example invoker: { namespace: "${namespace}", machineUserName: "${invoker}" }.`,
        context: { invoker, authNamespaces: defining, ...definitionContext(definition) },
      },
    );
  }
  return { namespace, machineUserName: invoker };
}

type AssertInvokerMachineUserParams = {
  invoker: AuthInvoker;
  /** File that names the invoker's Auth namespace: the config for a string invoker. */
  namespaceFile: string;
  definition: DefinitionRef;
  machineUsers: InvokerMachineUsers;
};

function assertInvokerMachineUser(params: AssertInvokerMachineUserParams): void {
  const {
    invoker: { namespace: authNamespace, machineUserName },
    namespaceFile,
    definition,
    machineUsers,
  } = params;
  const label = definitionLabel(definition);
  const known = machineUsers.get(authNamespace);
  if (known === undefined) {
    throw internalError(`Machine users of Auth namespace "${authNamespace}" were not listed`);
  }
  if (known === null) {
    throw locatedCLIError(
      { file: namespaceFile },
      {
        code: "INVOKER_AUTH_NOT_FOUND",
        message: `${label} uses invoker "${machineUserName}" of Auth service "${authNamespace}", but the workspace has no Auth service with that name.`,
        suggestion: `Name an existing Auth service, or deploy the config that defines "${authNamespace}" first or in the same run.`,
        context: { invoker: machineUserName, authNamespace, ...definitionContext(definition) },
      },
    );
  }
  if (known.has(machineUserName)) return;
  const names = [...known].toSorted();
  throw locatedCLIError(
    { file: definition.file },
    {
      code: "INVOKER_MACHINE_USER_NOT_FOUND",
      message: `${label} uses invoker "${machineUserName}", but Auth service "${authNamespace}" has no machine user with that name.`,
      suggestion: names.length
        ? `Use one of the existing machine users: ${names.join(", ")}.`
        : `Define the machine user in Auth service "${authNamespace}" before using it as invoker.`,
      context: {
        invoker: machineUserName,
        authNamespace,
        machineUsers: names,
        ...definitionContext(definition),
      },
    },
  );
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

/**
 * Collect what the invokers of a config resolve against.
 * @param context - Planning context of the config
 * @param invokers - Invokers of the config's executors or resolvers
 * @returns Auth namespaces of the config, the machine users of the namespaces the invokers name, and the config file
 */
export async function planInvokerScope(
  context: PlanContext,
  invokers: Iterable<string | AuthInvoker | undefined>,
): Promise<InvokerScope> {
  const authNamespaces = configAuthNamespaces(context);
  return {
    authNamespaces,
    machineUsers: await listInvokerMachineUsers({
      client: context.client,
      workspaceId: context.workspaceId,
      invokers,
      authNamespaces,
      plannedMachineUsers: context.plannedMachineUsers,
    }),
    configPath: context.config.path,
  };
}
