type ListTailorDBTypesClient = {
  listTailorDBTypes(args: { workspaceId: string; namespaceName: string }): Promise<{
    tailordbTypes: Array<{ name: string }>;
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

  const unresolvedTables = new Set(args.tableNames);
  const tableNamespaceMap = new Map<string, string>();

  for (const namespace of args.namespaces) {
    if (unresolvedTables.size === 0) {
      break;
    }

    try {
      const { tailordbTypes } = await args.client.listTailorDBTypes({
        workspaceId: args.workspaceId,
        namespaceName: namespace,
      });

      for (const type of tailordbTypes) {
        const matchedRequestedTypes = requestedTablesByLowercase.get(type.name.toLowerCase());
        if (!matchedRequestedTypes) {
          continue;
        }

        for (const requestedTableName of matchedRequestedTypes) {
          if (tableNamespaceMap.has(requestedTableName)) {
            continue;
          }
          tableNamespaceMap.set(requestedTableName, namespace);
          unresolvedTables.delete(requestedTableName);
        }
      }
    } catch {
      continue;
    }
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
