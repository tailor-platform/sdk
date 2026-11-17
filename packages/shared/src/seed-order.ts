/**
 * Order self-referencing records before splitting or inserting a batch.
 * Cycles retain their input order; duplicate IDs leave the entire input unchanged.
 * This function is embedded in generated scripts and must remain self-contained.
 */
export function sortBySelfReference<RecordType extends Record<string, unknown>>(
  records: RecordType[],
  fields: string[],
  fieldKeys: Record<string, string> = {},
): RecordType[] {
  function referencedValues(value: unknown, path: readonly string[]): unknown[] {
    if (Array.isArray(value)) return value.flatMap((item) => referencedValues(item, path));
    const [head, ...rest] = path;
    if (head === undefined) return value === null || value === undefined ? [] : [value];
    if (value === null || typeof value !== "object") return [];
    return referencedValues((value as Record<string, unknown>)[head], rest);
  }

  if (fields.length === 0 || records.length <= 1) return records;

  const byId = new Map<unknown, RecordType>();
  for (const record of records) byId.set(record.id, record);
  if (byId.size !== records.length) return records;

  // Build one lookup map per distinct target key used by the self-reference
  // fields, mapping that key's value on a record to the record's own id.
  const idsByKeyValue = new Map<string, Map<unknown, unknown>>();
  for (const field of fields) {
    const targetKey = fieldKeys[field] ?? "id";
    if (idsByKeyValue.has(targetKey)) continue;
    const map = new Map<unknown, unknown>();
    for (const record of records) {
      const keyValue = targetKey === "id" ? record.id : record[targetKey];
      if (keyValue !== null && keyValue !== undefined) map.set(keyValue, record.id);
    }
    idsByKeyValue.set(targetKey, map);
  }

  const inDegree = new Map<unknown, number>();
  const dependents = new Map<unknown, unknown[]>();
  for (const record of records) {
    inDegree.set(record.id, 0);
    dependents.set(record.id, []);
  }
  for (const record of records) {
    const id = record.id;
    for (const field of fields) {
      const targetKey = fieldKeys[field] ?? "id";
      for (const refValue of referencedValues(record, field.split("."))) {
        const parentId = idsByKeyValue.get(targetKey)?.get(refValue);
        if (parentId === undefined || parentId === id) continue;
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
        dependents.get(parentId)?.push(id);
      }
    }
  }

  const queue: unknown[] = [];
  for (const record of records) {
    if ((inDegree.get(record.id) ?? 0) === 0) queue.push(record.id);
  }

  const seen = new Set<unknown>();
  const orderedIds: unknown[] = [];
  // A head index is used instead of `queue.shift()`, which would reindex the
  // remaining array on every dequeue and make this Kahn traversal O(n²) over
  // a table's full record set.
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
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
    .filter((record): record is RecordType => record !== undefined);
}
