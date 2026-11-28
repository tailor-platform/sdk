import {
  convertDecimalRows,
  serializeDecimalParams,
  type DecimalClass,
} from "#/kysely/decimal-client";
import type { TailordbQueryField } from "#/runtime/index";
import type { PGliteField } from "./pglite-temporal";

// PostgreSQL type names of the column types the Platform converts or passes through, by OID.
const TYPE_NAMES: Readonly<Record<number, string>> = {
  16: "bool",
  18: "char",
  19: "name",
  23: "int4",
  25: "text",
  701: "float8",
  1082: "date",
  1083: "time",
  1184: "timestamptz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
  1000: "_bool",
  1007: "_int4",
  1009: "_text",
  1022: "_float8",
  1182: "_date",
  1183: "_time",
  1185: "_timestamptz",
  1231: "_numeric",
  2951: "_uuid",
  3807: "_jsonb",
};

/**
 * Describe PGlite result columns the way the Platform reports them: by column name and
 * PostgreSQL type name.
 * @param fields - Name and type OID of each column PGlite returned
 * @returns Name and type name of each column, `unknown` for a type the Platform does not return
 */
export function toQueryFields(fields: readonly PGliteField[] = []): TailordbQueryField[] {
  return fields.map(({ name, dataTypeID }) => ({
    name,
    typeName: TYPE_NAMES[dataTypeID] ?? "unknown",
  }));
}

/**
 * Turn `Decimal` query parameters into the text PGlite can parse.
 * @param params - Query parameters
 * @param decimal - The `Decimal` class, or `undefined` to leave the parameters alone
 * @returns The parameters with `Decimal` values as text
 */
export function serializeDecimalQueryParams(
  params: readonly unknown[],
  decimal: DecimalClass | undefined,
): unknown[] {
  return decimal ? (serializeDecimalParams(params, decimal) ?? []) : [...params];
}

/**
 * Convert the numeric columns of PGlite rows to `Decimal`.
 * @param rows - Rows PGlite returned
 * @param fields - Name and type OID of each column PGlite returned
 * @param decimal - The `Decimal` class, or `undefined` to leave the rows alone
 * @returns The rows with numeric columns as `Decimal`
 */
export function deserializeDecimalRows(
  rows: unknown[],
  fields: readonly PGliteField[] | undefined,
  decimal: DecimalClass | undefined,
): unknown[] {
  return decimal ? convertDecimalRows(rows, toQueryFields(fields), decimal) : rows;
}
