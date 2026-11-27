/**
 * Find the names that more than one namespace defines, such as TailorDB table or resolver names.
 * @param namesPerNamespace - The names each namespace defines
 * @returns The names two or more namespaces define
 */
export function namesSharedAcrossNamespaces(
  namesPerNamespace: Iterable<Iterable<string>>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const names of namesPerNamespace) {
    for (const name of new Set(names)) {
      if (seen.has(name)) {
        shared.add(name);
      }
      seen.add(name);
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
