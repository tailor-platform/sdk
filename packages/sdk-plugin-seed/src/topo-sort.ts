import type { SeedData } from "@tailor-platform/sdk/cli";

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

/**
 * Order a self-referencing table's full record set so a row referenced by
 * another row is always sorted before it.
 *
 * `chunkSeedData` splits a table's records across multiple script executions
 * purely by byte size, with no awareness of self-reference order. The
 * generated seed script's own `sortBySelfReference` can only reorder the
 * records it receives in a single execution, so a child that lands in an
 * earlier chunk than the parent it points to is inserted with no visibility
 * into that parent at all. Running this same topological sort over the
 * entire table before chunking guarantees a parent always sits in the same
 * chunk as, or an earlier chunk than, every one of its children.
 *
 * `record.id` is used as the map key to resolve edges, so it must be present
 * and unique across the table's records. If any id is missing (allowed when
 * not using `--upsert`) or duplicated, the map would collapse distinct
 * records onto the same key and silently drop them from the result; fall
 * back to the original order instead so no data is lost.
 * @param records - All records for a single self-referencing table
 * @param fields - The table's own self-referencing field names
 * @returns Records reordered so parents precede their children
 */
export function sortRecordsBySelfReference(
  records: SeedData[string],
  fields: string[],
): SeedData[string] {
  if (fields.length === 0 || records.length <= 1) return records;

  const byId = new Map<unknown, SeedData[string][number]>();
  for (const record of records) byId.set(record.id, record);
  if (byId.size !== records.length) return records;

  const inDegree = new Map<unknown, number>();
  const dependents = new Map<unknown, unknown[]>();
  for (const record of records) {
    inDegree.set(record.id, 0);
    dependents.set(record.id, []);
  }
  for (const record of records) {
    const id = record.id;
    for (const field of fields) {
      const parentId = record[field];
      if (parentId === null || parentId === undefined || parentId === id) continue;
      if (!byId.has(parentId)) continue;
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      dependents.get(parentId)?.push(id);
    }
  }

  const queue: unknown[] = [];
  for (const record of records) {
    if ((inDegree.get(record.id) ?? 0) === 0) queue.push(record.id);
  }

  const seen = new Set<unknown>();
  const orderedIds: unknown[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
    for (const dependentId of dependents.get(id) ?? []) {
      const remaining = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, remaining);
      if (remaining === 0) queue.push(dependentId);
    }
  }
  for (const record of records) {
    if (!seen.has(record.id)) orderedIds.push(record.id);
  }

  return orderedIds
    .map((id) => byId.get(id))
    .filter((record): record is SeedData[string][number] => record !== undefined);
}
