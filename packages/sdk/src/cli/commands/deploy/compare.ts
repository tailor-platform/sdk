/**
 * Stable JSON-like serialization that sorts object keys and ignores proto runtime metadata.
 * @param value - Value to serialize
 * @returns Stable serialized string
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, entryValue]) => key !== "$typeName" && entryValue !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }
  return JSON.stringify(value);
}

/**
 * Normalize a proto-ish object into a plain JSON-compatible structure for comparison.
 * @param value - Value to normalize
 * @returns Normalized value
 */
export function normalizeProtoConfig<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(stableStringify(value)) as T;
}

/**
 * Sort a string array for order-insensitive comparison.
 * @param values - Values to sort
 * @returns Sorted values
 */
export function normalizeStringArray(values: readonly string[] | undefined): string[] {
  return (values ?? []).toSorted();
}

/**
 * Compare two values after proto normalization.
 * @param left - Left value
 * @param right - Right value
 * @returns True when normalized values are equal
 */
export function areNormalizedEqual(left: unknown, right: unknown): boolean {
  return (
    stableStringify(normalizeProtoConfig(left)) === stableStringify(normalizeProtoConfig(right))
  );
}
