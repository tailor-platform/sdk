/**
 * Sort tables so that every table comes after the dependencies that are also in
 * the input list. Dependencies outside the list are ignored.
 * @param types - Table names to sort
 * @param deps - Seed dependencies (referenced table names) per table
 * @returns Table names in dependency order
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
