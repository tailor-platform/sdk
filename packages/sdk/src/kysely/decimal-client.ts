import { isStorableDecimal } from "#/runtime/decimal-range";
import type {
  TailordbClientInstance,
  TailordbQueryField,
  TailordbQueryResult,
} from "#/runtime/index";
import type { Decimal } from "decimal.js";

/** The `Decimal` class from decimal.js (or the one `@tailor-platform/sdk/runtime` exports). */
export type DecimalClass = typeof Decimal;

const NUMERIC = "numeric";
const NUMERIC_ARRAY = "_numeric";

function serializeParam(value: unknown, decimal: DecimalClass): unknown {
  if (decimal.isDecimal(value)) {
    const number: Decimal = value;
    if (!number.isFinite()) {
      throw new RangeError(`Expected a finite Decimal query parameter, but received ${number}`);
    }
    if (!isStorableDecimal(number)) {
      throw new RangeError("Decimal query parameter is out of range for a TailorDB decimal");
    }
    return number.toFixed();
  }
  if (Array.isArray(value)) return value.map((item) => serializeParam(item, decimal));
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, serializeParam(entry, decimal)]),
      );
    }
  }
  return value;
}

function toDecimal(value: unknown, decimal: DecimalClass): unknown {
  return typeof value === "string" ? new decimal(value) : value;
}

/**
 * Turn `Decimal` query parameters into the plain-notation text the Platform accepts.
 * @param args - Query parameters
 * @param decimal - The `Decimal` class the parameters were built with
 * @returns The parameters with every `Decimal`, also inside arrays and plain objects, as text
 * @internal
 */
export function serializeDecimalParams(
  args: readonly unknown[] | undefined,
  decimal: DecimalClass,
): unknown[] | undefined {
  return args?.map((arg) => serializeParam(arg, decimal));
}

/**
 * Convert the `numeric` and `numeric[]` columns of result rows to `Decimal`.
 * @param rows - Result rows
 * @param fields - Name and PostgreSQL type name of each result column
 * @param decimal - The `Decimal` class to build values with
 * @returns The rows, with each numeric column converted
 * @internal
 */
export function convertDecimalRows<O>(
  rows: O[],
  fields: readonly TailordbQueryField[],
  decimal: DecimalClass,
): O[] {
  const scalars = fields.filter((f) => f.typeName === NUMERIC).map((f) => f.name);
  const arrays = fields.filter((f) => f.typeName === NUMERIC_ARRAY).map((f) => f.name);
  if (scalars.length === 0 && arrays.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const name of scalars) copy[name] = toDecimal(copy[name], decimal);
    for (const name of arrays) {
      const value = copy[name];
      if (Array.isArray(value)) copy[name] = value.map((item) => toDecimal(item, decimal));
    }
    return copy as O;
  });
}

function toDecimalRows<O>(result: TailordbQueryResult<O>, decimal: DecimalClass): O[] {
  const { fields } = result;
  if (!fields) {
    throw new Error(
      "The Tailor Platform runtime did not report column types for this query, so decimal columns cannot be converted to Decimal. Use a Platform version that returns them, or turn the decimal option off.",
    );
  }
  return convertDecimalRows(result.rows, fields, decimal);
}

/**
 * Wrap a `tailordb.Client` so Kysely sends and receives `Decimal` values. Parameters that are
 * `Decimal` are sent as plain-notation text, and `numeric` result columns, found by the column
 * types the runtime reports, are returned as `Decimal`. Everything else passes through, so the
 * wrapper covers a transaction's queries too, which go through the same `queryObject`.
 * @param client - The client to wrap
 * @param decimal - The `Decimal` class to build values with
 * @returns A client with the same shape as the one given
 */
export function withDecimal<C extends TailordbClientInstance>(client: C, decimal: DecimalClass): C {
  const queryObject = async <O>(
    sql: string,
    args?: readonly unknown[],
  ): Promise<TailordbQueryResult<O>> => {
    const result = await client.queryObject<O>(sql, serializeDecimalParams(args, decimal));
    return { ...result, rows: toDecimalRows(result, decimal) };
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === "queryObject") return queryObject;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
