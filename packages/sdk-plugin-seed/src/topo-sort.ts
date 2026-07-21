/**
 * Sort types so that every type comes after the dependencies that are also in
 * the input list. Dependencies outside the list are ignored.
 * @param types - Type names to sort
 * @param deps - Seed dependencies (referenced type names) per type
 * @returns Type names in dependency order
 */
export function topologicalSort(types: string[], deps: Record<string, string[]>): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  const visit = (type: string): void => {
    if (visited.has(type)) return;
    visited.add(type);
    for (const dep of deps[type] ?? []) {
      if (types.includes(dep)) {
        visit(dep);
      }
    }
    result.push(type);
  };

  for (const type of types) {
    visit(type);
  }
  return result;
}
