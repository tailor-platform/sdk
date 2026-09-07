import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";

/**
 * Format a Date using its UTC calendar date.
 * @param date - Date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999) {
    throw new RangeError("Expected a valid Date with a year between 0000 and 9999");
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

function serializeValue(field: DateField, value: unknown, path: string): unknown {
  if (value === null || value === undefined) return value;
  if (field.type === "date" && field.metadata.as === "date") {
    if (!(value instanceof Date)) {
      throw new TypeError(`Expected a Date at ${path || "<root>"}`);
    }
    try {
      return formatDate(value);
    } catch (error) {
      throw new RangeError(`Invalid date at ${path || "<root>"}`, { cause: error });
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
