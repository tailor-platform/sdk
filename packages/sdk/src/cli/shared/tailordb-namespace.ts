import { MAX_PAGE_SIZE } from "./client";
import { CLIError } from "./errors";

type ListTailorDBTypesClient = {
  listTailorDBTypes(args: {
    workspaceId: string;
    namespaceName: string;
    pageToken: string;
    pageSize: number;
  }): Promise<{
    tailordbTypes: Array<{ name: string }>;
    nextPageToken: string;
  }>;
};

type ResolveTableNamespacesArgs = {
  workspaceId: string;
  namespaces: string[];
  tableNames: string[];
  client: ListTailorDBTypesClient;
};

/**
 * Resolve TailorDB table names to namespace names.
 * @param args - Resolution inputs
 * @returns Table to namespace map for found tables
 */
export async function resolveTableNamespaces(
  args: ResolveTableNamespacesArgs,
): Promise<Map<string, string>> {
  const requestedTablesByLowercase = new Map<string, string[]>();
  for (const tableName of args.tableNames) {
    const key = tableName.toLowerCase();
    const existing = requestedTablesByLowercase.get(key);
    if (existing) {
      existing.push(tableName);
      continue;
    }
    requestedTablesByLowercase.set(key, [tableName]);
  }

  const tableNamespaceMap = new Map<string, string>();

  if (args.tableNames.length === 0) return tableNamespaceMap;

  const requestedTableCount = new Set(args.tableNames).size;

  for (const namespace of args.namespaces) {
    const foundInNamespace = new Set<string>();
    let pageToken = "";
    do {
      const { tailordbTypes, nextPageToken } = await args.client.listTailorDBTypes({
        workspaceId: args.workspaceId,
        namespaceName: namespace,
        pageToken,
        pageSize: MAX_PAGE_SIZE,
      });

      for (const type of tailordbTypes) {
        const matchedRequestedTypes = requestedTablesByLowercase.get(type.name.toLowerCase());
        if (!matchedRequestedTypes) continue;

        for (const requestedTableName of matchedRequestedTypes) {
          const previousNamespace = tableNamespaceMap.get(requestedTableName);
          if (previousNamespace !== undefined && previousNamespace !== namespace) {
            throw CLIError({
              code: "TAILORDB_TABLE_NAMESPACE_AMBIGUOUS",
              message: `Table "${requestedTableName}" exists in multiple namespaces: ${previousNamespace}, ${namespace}.`,
              suggestion: "Use a config containing only the intended namespace.",
              context: { table: requestedTableName, namespaces: [previousNamespace, namespace] },
            });
          }
          tableNamespaceMap.set(requestedTableName, namespace);
          foundInNamespace.add(requestedTableName);
        }
      }

      pageToken = nextPageToken;
    } while (pageToken && foundInNamespace.size < requestedTableCount);
  }

  return tableNamespaceMap;
}

type ResolveTableNamespaceArgs = {
  workspaceId: string;
  namespaces: string[];
  tableName: string;
  client: ListTailorDBTypesClient;
};

/**
 * Resolve a single TailorDB table name to namespace.
 * @param args - Resolution inputs
 * @returns Namespace name if found
 */
export async function resolveTableNamespace(
  args: ResolveTableNamespaceArgs,
): Promise<string | null> {
  const tableNamespaceMap = await resolveTableNamespaces({
    workspaceId: args.workspaceId,
    namespaces: args.namespaces,
    tableNames: [args.tableName],
    client: args.client,
  });

  return tableNamespaceMap.get(args.tableName) ?? null;
}
