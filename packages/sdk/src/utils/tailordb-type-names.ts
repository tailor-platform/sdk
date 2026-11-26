/** A TailorDB namespace and the names of the types it defines. */
export interface NamespaceTypeNames {
  namespace: string;
  typeNames: Iterable<string>;
}

/**
 * Find the TailorDB type names that more than one namespace defines.
 * @param namespaces - Each namespace with the names of its types
 * @returns The type names two or more namespaces define
 */
export function sharedTailorDBTypeNames(
  namespaces: Iterable<NamespaceTypeNames>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { typeNames } of namespaces) {
    for (const typeName of new Set(typeNames)) {
      if (seen.has(typeName)) {
        shared.add(typeName);
      }
      seen.add(typeName);
    }
  }
  return shared;
}

/**
 * Name a TailorDB type in generated output and messages: its own name, or `<namespace>.<name>`
 * when several namespaces define that name.
 * @param namespace - Namespace of the type
 * @param typeName - Name of the type
 * @param sharedTypeNames - Type names several namespaces define
 * @returns The name that tells the type apart from the other namespaces' types
 */
export function qualifiedTailorDBTypeName(
  namespace: string,
  typeName: string,
  sharedTypeNames: ReadonlySet<string>,
): string {
  return sharedTypeNames.has(typeName) ? `${namespace}.${typeName}` : typeName;
}
