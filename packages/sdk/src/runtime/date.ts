import { getTemporal } from "./temporal";
import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";
import type { Temporal } from "temporal-spec";

/**
 * Format a Date using its UTC calendar date.
 * @param date - Date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDate(date: Date): string {
  return formatDateTime(date).slice(0, 10);
}

function formatDateTime(date: Date): string {
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999) {
    const received = Number.isNaN(date.getTime()) ? "an invalid Date" : `year ${year}`;
    throw new RangeError(
      `Expected a Date with a 4-digit year (0000-9999), but received ${received}`,
    );
  }
  return date.toISOString();
}

function formatHoursMinutes(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Expected a valid Date, but received an invalid Date");
  }
  return formatHoursMinutes(date.getUTCHours(), date.getUTCMinutes());
}

function formatTemporal(value: Temporal.PlainDate | Temporal.Instant | Temporal.PlainTime): string {
  const Temporal = getTemporal();
  if (value instanceof Temporal.PlainTime) return formatHoursMinutes(value.hour, value.minute);
  const iso = value.toString({ calendarName: "never" });
  if (!/^\d{4}-/.test(iso)) {
    const isInstant = value instanceof Temporal.Instant;
    throw new RangeError(
      `Expected a Temporal.${isInstant ? "Instant" : "PlainDate"} with a 4-digit ${isInstant ? "UTC " : ""}year (0000-9999), but received ${iso}`,
    );
  }
  return iso;
}

type DateField = {
  readonly type: TailorFieldType;
  readonly metadata: FieldMetadata;
  readonly fields: Record<string, DateField>;
};

type DateRepresentationField = {
  readonly type: TailorFieldType;
  readonly metadata: Pick<FieldMetadata, "as">;
  readonly fields: Record<string, DateRepresentationField>;
};

function serialize(field: DateField, value: unknown, path: string): unknown {
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

const MAX_DESCRIBED_VALUE_LENGTH = 100;
const MAX_DESCRIBED_ARRAY_SAMPLE = 100;

function truncateForDescription(text: string): string {
  return text.length > MAX_DESCRIBED_VALUE_LENGTH
    ? `${text.slice(0, MAX_DESCRIBED_VALUE_LENGTH)}...`
    : text;
}

function describeReceivedValue(value: unknown): string {
  if (Array.isArray(value)) {
    const sample = value.slice(0, MAX_DESCRIBED_ARRAY_SAMPLE);
    const elementTypes = [...new Set(Array.from(sample, (item) => typeof item))];
    return elementTypes.length > 0 ? `an array of ${elementTypes.join("/")}` : "an empty array";
  }
  if (typeof value === "string")
    return `a string (${JSON.stringify(truncateForDescription(value))})`;
  const type = typeof value;
  if (type === "object") return "an object";
  if (type === "function") return "a function";
  return `a ${type} (${truncateForDescription(String(value))})`;
}

type DateRepresentation = "date" | "temporal";

/**
 * Get the Date or Temporal representation a field converts its values to.
 * @param type - Field type
 * @param as - The field's `as` option
 * @returns The representation, or undefined when values stay strings
 * @internal
 */
export function dateRepresentationOf(
  type: TailorFieldType,
  as: FieldMetadata["as"],
): DateRepresentation | undefined {
  return (type === "date" || type === "datetime" || type === "time") &&
    (as === "date" || as === "temporal")
    ? as
    : undefined;
}

function isDateRepresentationField(
  field: DateRepresentationField,
  representation?: DateRepresentation,
): boolean {
  const as = dateRepresentationOf(field.type, field.metadata.as);
  return as !== undefined && (representation === undefined || as === representation);
}

type DateSerializer = (type: TailorFieldType, value: unknown, path: string) => string;

function throwInvalidDate(error: unknown, path: string): never {
  const reason = error instanceof Error ? error.message : String(error);
  throw new RangeError(`Invalid date at ${describePathTarget(path)}: ${reason}`, {
    cause: error,
  });
}

function serializeAsDate(type: TailorFieldType, value: unknown, path: string): string {
  if (!(value instanceof Date)) {
    throw new TypeError(
      `Expected a Date instance at ${describePathTarget(path)}, but received ${describeReceivedValue(value)}`,
    );
  }
  try {
    if (type === "datetime") return formatDateTime(value);
    if (type === "time") return formatTime(value);
    return formatDate(value);
  } catch (error) {
    return throwInvalidDate(error, path);
  }
}

function serializeAsTemporal(type: TailorFieldType, value: unknown, path: string): string {
  const Temporal = getTemporal();
  const expected =
    type === "date"
      ? Temporal.PlainDate
      : type === "datetime"
        ? Temporal.Instant
        : Temporal.PlainTime;
  if (!(value instanceof expected)) {
    throw new TypeError(
      `Expected a Temporal.${expected.name} instance at ${describePathTarget(path)}, but received ${describeReceivedValue(value)}`,
    );
  }
  try {
    return formatTemporal(value);
  } catch (error) {
    return throwInvalidDate(error, path);
  }
}

type MaybeProcessGlobal = { process?: { env: Record<string, string | undefined> } };

const dateSerializers: Record<DateRepresentation, DateSerializer | undefined> = {
  date: (globalThis as MaybeProcessGlobal).process?.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_DATE
    ? undefined
    : serializeAsDate,
  temporal: (globalThis as MaybeProcessGlobal).process?.env
    .__TAILOR_PLATFORM_BUNDLE_WITHOUT_TEMPORAL
    ? undefined
    : serializeAsTemporal,
};

function serializeValue(field: DateField, value: unknown, path: string): unknown {
  if (value === null || value === undefined) return value;
  const { type } = field;
  const as = dateRepresentationOf(type, field.metadata.as);
  if (as) {
    const serializeAs = dateSerializers[as];
    if (!serializeAs) {
      throw new Error(
        `Serializing fields declared with as: "${as}" is not included in this bundle.`,
      );
    }
    return serializeAs(type, value, path);
  }
  if (type !== "nested" || typeof value !== "object" || Array.isArray(value)) return value;
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
 * Check whether a field or any of its nested fields uses a Date or Temporal representation.
 * @param field - Field to inspect
 * @param representation - Only match fields using this representation
 * @returns Whether serializeDateFields would convert any value of the field
 * @internal
 */
export function hasDateRepresentationFields(
  field: DateRepresentationField,
  representation?: DateRepresentation,
): boolean {
  return (
    isDateRepresentationField(field, representation) ||
    Object.values(field.fields).some((child) => hasDateRepresentationFields(child, representation))
  );
}

/**
 * Convert fields using Date or Temporal representations to date, datetime, or time strings.
 * @param field - Field defining the value's shape
 * @param value - Value to serialize
 * @returns Value with Date and Temporal fields converted to strings
 * @internal
 */
export function serializeDateFields(field: DateField, value: unknown): unknown {
  return serialize(field, value, "");
}
