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

const DEFAULT_DIFF_LINE_LIMIT = 40;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  return stableStringify(value);
}

function describePresence(value: unknown): "present" | "missing" {
  return value === undefined || value === null ? "missing" : "present";
}

/**
 * Collect field-path diff lines between two normalized values.
 * @param left - Remote/current value
 * @param right - Desired/local value
 * @param maxLines - Maximum number of diff lines to emit
 * @returns Diff lines
 */
export function collectDiffLines(
  left: unknown,
  right: unknown,
  maxLines = DEFAULT_DIFF_LINE_LIMIT,
): string[] {
  const lines: string[] = [];
  const normalizedLeft = normalizeProtoConfig(left);
  const normalizedRight = normalizeProtoConfig(right);

  const walk = (leftValue: unknown, rightValue: unknown, path: string) => {
    if (lines.length >= maxLines) {
      return;
    }

    if (stableStringify(leftValue) === stableStringify(rightValue)) {
      return;
    }

    if (
      ((leftValue === undefined || leftValue === null) &&
        (Array.isArray(rightValue) || isPlainObject(rightValue))) ||
      ((rightValue === undefined || rightValue === null) &&
        (Array.isArray(leftValue) || isPlainObject(leftValue)))
    ) {
      lines.push(
        `${path}: remote=${describePresence(leftValue)} local=${describePresence(rightValue)}`,
      );
      return;
    }

    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      const leftArray = Array.isArray(leftValue) ? leftValue : [];
      const rightArray = Array.isArray(rightValue) ? rightValue : [];
      const maxLength = Math.max(leftArray.length, rightArray.length);
      for (let index = 0; index < maxLength; index += 1) {
        walk(leftArray[index], rightArray[index], `${path}[${index}]`);
        if (lines.length >= maxLines) {
          return;
        }
      }
      return;
    }

    if (isPlainObject(leftValue) || isPlainObject(rightValue)) {
      const leftObject = isPlainObject(leftValue) ? leftValue : {};
      const rightObject = isPlainObject(rightValue) ? rightValue : {};
      const keys = new Set([...Object.keys(leftObject), ...Object.keys(rightObject)]);
      for (const key of [...keys].sort()) {
        walk(leftObject[key], rightObject[key], path === "$" ? key : `${path}.${key}`);
        if (lines.length >= maxLines) {
          return;
        }
      }
      return;
    }

    lines.push(
      `${path}: remote=${formatDiffValue(leftValue)} local=${formatDiffValue(rightValue)}`,
    );
  };

  walk(normalizedLeft, normalizedRight, "$");

  if (lines.length >= maxLines) {
    return [...lines.slice(0, maxLines), "...diff output truncated"];
  }

  return lines;
}
