import type { Temporal as TemporalTypes } from "temporal-spec";

/** Name and Postgres type OID of a column PGlite returned. */
export interface PGliteField {
  /** Column name */
  name: string;
  /** Postgres type OID */
  dataTypeID: number;
}

const DATE_OID = 1082;
const TIME_OID = 1083;
const TIMESTAMPTZ_OID = 1184;
const DATE_ARRAY_OID = 1182;
const TIME_ARRAY_OID = 1183;
const TIMESTAMPTZ_ARRAY_OID = 1185;

type Converter = (value: unknown, temporal: typeof TemporalTypes) => unknown;

const toPlainDate: Converter = (value, temporal) =>
  value instanceof Date
    ? new temporal.PlainDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
    : value;
const toInstant: Converter = (value, temporal) =>
  value instanceof Date ? temporal.Instant.fromEpochMilliseconds(value.getTime()) : value;
const toPlainTime: Converter = (value, temporal) =>
  typeof value === "string" ? temporal.PlainTime.from(value) : value;
const eachElement =
  (convert: Converter): Converter =>
  (value, temporal) =>
    Array.isArray(value) ? value.map((element) => convert(element, temporal)) : value;

const CONVERTERS: Record<number, Converter> = {
  [DATE_OID]: toPlainDate,
  [TIMESTAMPTZ_OID]: toInstant,
  [TIME_OID]: toPlainTime,
  [DATE_ARRAY_OID]: eachElement(toPlainDate),
  [TIMESTAMPTZ_ARRAY_OID]: eachElement(toInstant),
  [TIME_ARRAY_OID]: eachElement(toPlainTime),
};

function hostTemporal(): typeof TemporalTypes | undefined {
  return (globalThis as { Temporal?: typeof TemporalTypes }).Temporal;
}

function serializeValue(value: unknown, temporal: typeof TemporalTypes): unknown {
  if (value instanceof temporal.PlainDate) return value.toString({ calendarName: "never" });
  if (value instanceof temporal.Instant || value instanceof temporal.PlainTime) {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map((element) => serializeValue(element, temporal));
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, serializeValue(entry, temporal)]),
      );
    }
  }
  return value;
}

/**
 * Turn Temporal query parameters into the strings `tailordb.Client` sends for them, so
 * PGlite receives values Postgres can parse.
 * @param params - Query parameters
 * @returns Parameters with Temporal values serialized
 */
export function serializeTemporalParams(params: readonly unknown[]): unknown[] {
  const temporal = hostTemporal();
  if (!temporal) return [...params];
  return params.map((param) => serializeValue(param, temporal));
}

/**
 * Convert date/timestamptz/time columns of PGlite rows into the Temporal values a
 * `tailordb.Client` created with `{ temporal: true }` returns.
 * @param rows - Rows PGlite returned
 * @param fields - Name and Postgres type OID of each returned column
 * @returns Rows with date/timestamptz/time columns as Temporal values
 */
export function deserializeTemporalRows(
  rows: unknown[],
  fields: readonly PGliteField[] = [],
): unknown[] {
  const converted = fields.flatMap(({ name, dataTypeID }) => {
    const convert = CONVERTERS[dataTypeID];
    return convert ? [{ name, convert }] : [];
  });
  if (converted.length === 0) return rows;
  const temporal = hostTemporal();
  if (!temporal) {
    throw new ReferenceError(
      "Temporal is unavailable. Use the SDK tailor-runtime Vitest environment to read Temporal values from PGlite.",
    );
  }
  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const { name, convert } of converted) {
      copy[name] = convert(copy[name], temporal);
    }
    return copy;
  });
}
