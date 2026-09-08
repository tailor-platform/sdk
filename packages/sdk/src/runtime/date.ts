import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";

/**
 * Format a Date using its UTC calendar date.
 * @param date - Date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999) {
    const received = Number.isNaN(date.getTime()) ? "an invalid Date" : `year ${year}`;
    throw new RangeError(
      `Expected a Date with a 4-digit year (0000-9999), but received ${received}`,
    );
  }
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

type DateField = {
  readonly type: TailorFieldType;
  readonly metadata: FieldMetadata;
  readonly fields: Record<string, DateField>;
};

function serialize(field: DateField, value: unknown, path: string): unknown {
  if (value === null || value === undefined) return value;
  if (field.metadata.array) {
    if (!Array.isArray(value)) return value;
    const converted = value.map((item, index) => serializeValue(field, item, `${path}[${index}]`));
    return converted.every((item, index) => item === value[index]) ? value : converted;
  }
  return serializeValue(field, value, path);
}

function describePathTarget(path: string): string {
  return path || "the top-level value";
}

function describeReceivedValue(value: unknown): string {
  if (Array.isArray(value)) {
    const elementTypes = [...new Set(value.map((item) => typeof item))];
    return elementTypes.length > 0 ? `an array of ${elementTypes.join("/")}` : "an empty array";
  }
  const type = typeof value;
  if (type === "object") return "an object";
  if (type === "function") return "a function";
  return type === "string" ? `a string (${JSON.stringify(value)})` : `a ${type} (${String(value)})`;
}

function serializeValue(field: DateField, value: unknown, path: string): unknown {
  if (value === null || value === undefined) return value;
  if (field.type === "date" && field.metadata.as === "date") {
    if (!(value instanceof Date)) {
      throw new TypeError(
        `Expected a Date instance at ${describePathTarget(path)}, but received ${describeReceivedValue(value)}`,
      );
    }
    try {
      return formatDate(value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RangeError(`Invalid date at ${describePathTarget(path)}: ${reason}`, {
        cause: error,
      });
    }
  }
  if (field.type !== "nested" || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  let result = record;
  for (const [key, child] of Object.entries(field.fields)) {
    const converted = serialize(child, record[key], path ? `${path}.${key}` : key);
    if (converted !== record[key]) {
      if (result === record) result = { ...record };
      Object.defineProperty(result, key, {
        value: converted,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}

/**
 * Convert fields using the Date representation to YYYY-MM-DD strings in UTC.
 * @param field - Date or object field defining the value's shape
 * @param value - Value to serialize
 * @returns Value with Date fields converted to strings
 * @internal
 */
export function serializeDateFields(field: DateField, value: unknown): unknown {
  return serialize(field, value, "");
}
