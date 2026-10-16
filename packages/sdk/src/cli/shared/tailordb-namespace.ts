import { MAX_PAGE_SIZE } from "./client";

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

type ResolveTypeNamespacesArgs = {
  workspaceId: string;
  namespaces: string[];
  typeNames: string[];
  client: ListTailorDBTypesClient;
};

/**
 * Resolve TailorDB type names to namespace names.
 * @param args - Resolution inputs
 * @returns Type to namespace map for found types
 */
export async function resolveTypeNamespaces(
  args: ResolveTypeNamespacesArgs,
): Promise<Map<string, string>> {
  const requestedTypesByLowercase = new Map<string, string[]>();
  for (const typeName of args.typeNames) {
    const key = typeName.toLowerCase();
    const existing = requestedTypesByLowercase.get(key);
    if (existing) {
      existing.push(typeName);
      continue;
    }
    requestedTypesByLowercase.set(key, [typeName]);
  }

  const unresolvedTypes = new Set(args.typeNames);
  const typeNamespaceMap = new Map<string, string>();

  for (const namespace of args.namespaces) {
    if (unresolvedTypes.size === 0) {
      break;
    }

    let pageToken = "";
    do {
      const { tailordbTypes, nextPageToken } = await args.client.listTailorDBTypes({
        workspaceId: args.workspaceId,
        namespaceName: namespace,
        pageToken,
        pageSize: MAX_PAGE_SIZE,
      });

      for (const type of tailordbTypes) {
        const matchedRequestedTypes = requestedTypesByLowercase.get(type.name.toLowerCase());
        if (!matchedRequestedTypes) {
          continue;
        }

        for (const requestedTypeName of matchedRequestedTypes) {
          if (typeNamespaceMap.has(requestedTypeName)) {
            continue;
          }
          typeNamespaceMap.set(requestedTypeName, namespace);
          unresolvedTypes.delete(requestedTypeName);
        }
      }

      pageToken = nextPageToken;
    } while (pageToken && unresolvedTypes.size > 0);
  }

  return typeNamespaceMap;
}

type ResolveTypeNamespaceArgs = {
  workspaceId: string;
  namespaces: string[];
  typeName: string;
  client: ListTailorDBTypesClient;
};

/**
 * Resolve a single TailorDB type name to namespace.
 * @param args - Resolution inputs
 * @returns Namespace name if found
 */
export async function resolveTypeNamespace(args: ResolveTypeNamespaceArgs): Promise<string | null> {
  const typeNamespaceMap = await resolveTypeNamespaces({
    workspaceId: args.workspaceId,
    namespaces: args.namespaces,
    typeNames: [args.typeName],
    client: args.client,
  });

  return typeNamespaceMap.get(args.typeName) ?? null;
}
