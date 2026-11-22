import { isNotFoundError, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import type { Order } from "#/cli/shared/args";
import type { LoadedConfigFile } from "#/cli/shared/config-loader";
import type { Application } from "@tailor-platform/tailor-proto/application_resource_pb";

interface LoadAuthApplicationParams {
  client: OperatorClient;
  workspaceId: string;
  name: string;
}

/**
 * Get a deployed application, which must use an Auth service.
 * @param params - Client, workspace, and application name
 * @returns The application
 */
export async function loadAuthApplication(params: LoadAuthApplicationParams): Promise<Application> {
  const { client, workspaceId, name } = params;
  const { application } = await client.getApplication({ workspaceId, applicationName: name });
  if (!application?.authNamespace) {
    throw CLIError({
      code: "AUTH_CONFIG_REQUIRED",
      message: `Application ${name} does not have an auth configuration.`,
    });
  }
  return application;
}

interface ListedAuthNamespacesParams {
  client: OperatorClient;
  workspaceId: string;
  loaded: LoadedConfigFile;
}

/**
 * Auth services a list command covers: the deployed application's for a `defineConfig()` config,
 * and every Auth service of a workspace config.
 * @param params - Client, workspace, and loaded config file
 * @returns Auth namespaces in declaration order
 */
export async function listedAuthNamespaces(params: ListedAuthNamespacesParams): Promise<string[]> {
  const { client, workspaceId, loaded } = params;
  if (loaded.kind === "config") {
    const application = await loadAuthApplication({
      client,
      workspaceId,
      name: loaded.config.name,
    });
    return [application.authNamespace];
  }
  const authNamespaces = Object.keys(loaded.workspace.auth);
  if (authNamespaces.length === 0) {
    throw CLIError({
      code: "AUTH_CONFIG_REQUIRED",
      message: "No Auth service configured.",
      suggestion: "Ensure tailor.config.ts has an auth config.",
    });
  }
  return authNamespaces;
}

interface ListAcrossAuthNamespacesParams<T> {
  authNamespaces: ReadonlyArray<string>;
  /** Order of the combined list by creation time; undefined lists one Auth service after another. */
  order: Order | undefined;
  /** Maximum number of items in the combined list; 0 or undefined lists every item. */
  limit: number | undefined;
  /** What the items are, as the warning about an Auth service that is not deployed names them. */
  itemLabel: string;
  /** Fetch up to `limit` items of an Auth service, in `order`. */
  fetch: (authNamespace: string, limit: number | undefined) => Promise<T[]>;
  createdAt: (item: T) => Date | null;
}

/**
 * List items of several Auth services as one list, skipping an Auth service that is not deployed.
 * @param params - Auth services, ordering, limit, and how to fetch and date the items
 * @returns The combined items
 */
export async function listAcrossAuthNamespaces<T>(
  params: ListAcrossAuthNamespacesParams<T>,
): Promise<T[]> {
  const { authNamespaces, order, limit, itemLabel, fetch, createdAt } = params;
  const lists = await Promise.all(
    authNamespaces.map(async (authNamespace) => {
      try {
        return await fetch(authNamespace, limit);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        logger.warn(
          `Skipped the ${itemLabel} of Auth service "${authNamespace}", which is not deployed yet.`,
        );
        return [];
      }
    }),
  );
  const items = lists.flat();
  const ordered = order === undefined ? items : items.toSorted(creationOrder(order, createdAt));
  return limit ? ordered.slice(0, limit) : ordered;
}

function creationOrder<T>(
  order: Order,
  createdAt: (item: T) => Date | null,
): (a: T, b: T) => number {
  const time = (item: T) => createdAt(item)?.getTime() ?? Number.POSITIVE_INFINITY;
  const ascending = (a: T, b: T) => {
    const [x, y] = [time(a), time(b)];
    return x === y ? 0 : x < y ? -1 : 1;
  };
  return order === "asc" ? ascending : (a, b) => ascending(b, a);
}
