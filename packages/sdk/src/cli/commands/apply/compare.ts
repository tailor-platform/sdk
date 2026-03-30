import { styles, symbols } from "@/cli/shared/logger";

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
      .sort(([left], [right]) => left.localeCompare(right));
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
  return [...(values ?? [])].sort();
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

/**
 * Check whether a value is a plain object.
 * @param value - Value to inspect
 * @returns True when the value is a non-array object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatPath(path: readonly (string | number)[]): string {
  const normalizedPath = [...path];
  if (normalizedPath[0] === "schema") {
    normalizedPath.shift();
  }
  if (
    normalizedPath[0] === "fields" &&
    typeof normalizedPath[1] === "string" &&
    normalizedPath[2] === "hooks" &&
    typeof normalizedPath[3] === "string" &&
    normalizedPath[4] === "expr"
  ) {
    return `hooks.${normalizedPath[1]}.${normalizedPath[3]}`;
  }
  if (normalizedPath.at(-1) === "expr") {
    normalizedPath.pop();
  }

  return normalizedPath.reduce<string>((acc, segment) => {
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return acc ? `${acc}.${segment}` : segment;
  }, "");
}

function isCodeLikeValue(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.includes("=>") || value.includes("function") || value.includes("_value"))
  );
}

function formatDiffValue(value: unknown): string {
  if (isCodeLikeValue(value)) {
    return "script";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}

function formatAddedLine(path: readonly (string | number)[], value: unknown): string {
  if (isCodeLikeValue(value)) {
    return styles.create(`${symbols.create} ${formatPath(path)} -> (added)`);
  }
  return styles.create(`${symbols.create} ${formatPath(path)}: ${formatDiffValue(value)}`);
}

function formatRemovedLine(path: readonly (string | number)[]): string {
  return styles.delete(`${symbols.delete} ${formatPath(path)} -> (removed)`);
}

function formatUpdatedLine(
  path: readonly (string | number)[],
  before: unknown,
  after: unknown,
): string {
  const formattedPath = formatPath(path);
  if (isCodeLikeValue(before) || isCodeLikeValue(after)) {
    return styles.update(`${symbols.update} ${formattedPath} -> (changed)`);
  }
  return styles.update(
    `${symbols.update} ${formattedPath}: ${formatDiffValue(before)} -> ${formatDiffValue(after)}`,
  );
}

function collectDiffLines(
  before: unknown,
  after: unknown,
  path: readonly (string | number)[],
): string[] {
  if (stableStringify(before) === stableStringify(after)) {
    return [];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    const lines: string[] = [];
    for (let index = 0; index < maxLength; index += 1) {
      if (index >= before.length) {
        lines.push(formatAddedLine([...path, index], after[index]));
        continue;
      }
      if (index >= after.length) {
        lines.push(formatRemovedLine([...path, index]));
        continue;
      }
      lines.push(...collectDiffLines(before[index], after[index], [...path, index]));
    }
    return lines;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const lines: string[] = [];
    for (const key of keys) {
      const beforeValue = before[key];
      const afterValue = after[key];
      if (beforeValue === undefined && afterValue !== undefined) {
        lines.push(formatAddedLine([...path, key], afterValue));
        continue;
      }
      if (beforeValue !== undefined && afterValue === undefined) {
        lines.push(formatRemovedLine([...path, key]));
        continue;
      }
      lines.push(...collectDiffLines(beforeValue, afterValue, [...path, key]));
    }
    return lines;
  }

  if (before === undefined) {
    return [formatAddedLine(path, after)];
  }

  if (after === undefined) {
    return [formatRemovedLine(path)];
  }

  return [formatUpdatedLine(path, before, after)];
}

function collectSnapshotLines(
  value: unknown,
  path: readonly (string | number)[],
  mode: "added" | "removed",
): string[] {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSnapshotLines(item, [...path, index], mode));
  }

  if (isPlainObject(value)) {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entryValue]) => collectSnapshotLines(entryValue, [...path, key], mode));
  }

  return [mode === "added" ? formatAddedLine(path, value) : formatRemovedLine(path)];
}

/**
 * Create human-readable property diff lines from two normalized values.
 * @param before - Previous normalized value
 * @param after - Next normalized value
 * @returns Property-level diff lines
 */
export function formatPropertyDiffLines(before: unknown, after: unknown): string[] {
  return collectDiffLines(before, after, []);
}

/**
 * Create human-readable property snapshot lines for created values.
 * @param value - Created normalized value
 * @returns Property-level lines for new values
 */
export function formatAddedPropertyLines(value: unknown): string[] {
  return collectSnapshotLines(value, [], "added");
}
