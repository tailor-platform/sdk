import { assertDefined } from "#/utils/assert";
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
 * Find every namespace that has each TailorDB table. A table name matches with the same case
 * when any namespace has it so; otherwise it matches case-insensitively.
 * @param args - Resolution inputs
 * @returns Namespaces of each found table, in the given namespace order; tables no namespace has are left out
 */
export async function resolveTableNamespaces(
  args: ResolveTableNamespacesArgs,
): Promise<Map<string, string[]>> {
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

  const exact = new Map<string, string[]>();
  const caseInsensitive = new Map<string, string[]>();
  const add = (matches: Map<string, string[]>, tableName: string, namespace: string) => {
    const namespaces = matches.get(tableName) ?? [];
    if (!namespaces.includes(namespace)) namespaces.push(namespace);
    matches.set(tableName, namespaces);
  };

  for (const namespace of args.namespaces) {
    const unfound = new Set(args.tableNames);
    let pageToken = "";
    do {
      const { tailordbTypes, nextPageToken } = await args.client.listTailorDBTypes({
        workspaceId: args.workspaceId,
        namespaceName: namespace,
        pageToken,
        pageSize: MAX_PAGE_SIZE,
      });

      for (const type of tailordbTypes) {
        for (const requestedTableName of requestedTablesByLowercase.get(type.name.toLowerCase()) ??
          []) {
          add(caseInsensitive, requestedTableName, namespace);
          if (type.name === requestedTableName) {
            add(exact, requestedTableName, namespace);
            unfound.delete(requestedTableName);
          }
        }
      }

      pageToken = nextPageToken;
    } while (pageToken && unfound.size > 0);
  }

  return new Map(
    [...caseInsensitive].map(([tableName, namespaces]) => [
      tableName,
      exact.get(tableName) ?? namespaces,
    ]),
  );
}

/**
 * Resolve each TailorDB table name to the one namespace that has it.
 * @param args - Resolution inputs
 * @returns Namespace of each found table; tables no namespace has are left out
 */
export async function resolveUniqueTableNamespaces(
  args: ResolveTableNamespacesArgs,
): Promise<Map<string, string>> {
  const found = await resolveTableNamespaces(args);
  const ambiguous = [...found]
    .filter(([, namespaces]) => namespaces.length > 1)
    .map(([table, namespaces]) => ({ table, namespaces }));
  if (ambiguous.length > 0) {
    throw CLIError({
      code: "TAILORDB_TABLE_NAMESPACE_AMBIGUOUS",
      message: `Several TailorDB namespaces have ${ambiguous
        .map(({ table, namespaces }) => `table "${table}" (${namespaces.join(", ")})`)
        .join(", ")}.`,
      suggestion: "Pass --namespace to choose the namespace.",
      context: { tables: ambiguous },
    });
  }
  return new Map(
    [...found].map(([table, namespaces]) => [
      table,
      assertDefined(namespaces[0], "table namespace missing"),
    ]),
  );
}
