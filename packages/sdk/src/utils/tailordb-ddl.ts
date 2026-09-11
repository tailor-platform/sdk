/**
 * PostgreSQL DDL derived from TailorDB table definitions, for creating the
 * tables a PGlite-backed test needs. The columns match the flat shape the
 * Kysely type generators emit, not TailorDB's storage layout.
 */

/** The field shape the DDL generator reads; parsed and snapshot field configs are both assignable. */
export interface DDLFieldConfig {
  type: string;
  required?: boolean;
  array?: boolean;
  unique?: boolean;
  serial?: { start: number; maxValue?: number; format?: string };
  scale?: number;
  default?: unknown;
  optionalOnCreate?: boolean;
  hooks?: { create?: unknown; update?: unknown };
  fields?: Record<string, DDLFieldConfig>;
}

/** A table to emit DDL for. */
export interface DDLTableConfig {
  name: string;
  fields: Record<string, DDLFieldConfig>;
  indexes?: Record<string, { fields: string[]; unique?: boolean }>;
}

const MAX_IDENTIFIER_BYTES = 63;
// The platform rounds decimals to their scale (6 unless configured); numeric
// needs a precision to carry a scale, and the maximum leaves it unconstrained.
const DECIMAL_PRECISION = 1000;
const DEFAULT_DECIMAL_SCALE = 6;
const utf8 = new TextEncoder();

/**
 * Map a TailorDB field type to the PostgreSQL column type PGlite tests use for it.
 * @param fieldType - TailorDB field type name
 * @returns The PostgreSQL type name
 * @throws If the type is not a TailorDB field type
 */
export function mapFieldTypeToPostgresType(fieldType: string): string {
  switch (fieldType) {
    case "uuid":
      return "uuid";
    case "string":
    case "enum":
      return "text";
    case "boolean":
    case "bool":
      return "boolean";
    case "integer":
      return "integer";
    case "float":
      return "double precision";
    case "decimal":
      return "numeric";
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "time":
      return "time";
    case "nested":
      return "jsonb";
    default:
      throw new Error(`Field type "${fieldType}" has no PostgreSQL column type.`);
  }
}

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Postgres truncates identifiers to 63 bytes, which would let two long
// derived names collide and `IF NOT EXISTS` skip the second. Table and
// column names are left alone: their truncation is applied to queries too.
function derivedIdentifier(name: string): string {
  if (utf8.encode(name).length <= MAX_IDENTIFIER_BYTES) return identifier(name);
  const suffix = `_${fnv1aHex(name)}`;
  let head = name;
  while (utf8.encode(head + suffix).length > MAX_IDENTIFIER_BYTES) head = head.slice(0, -1);
  return identifier(head + suffix);
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function columnType(field: DDLFieldConfig): string {
  const base =
    field.type === "decimal"
      ? `numeric(${DECIMAL_PRECISION}, ${field.scale ?? DEFAULT_DECIMAL_SCALE})`
      : mapFieldTypeToPostgresType(field.type);
  return field.array && field.type !== "nested" ? `${base}[]` : base;
}

function scalarLiteral(value: unknown, field: DDLFieldConfig, label: string): string {
  const pgType = mapFieldTypeToPostgresType(field.type);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Default of field ${label} is an invalid Date.`);
    }
    return `${stringLiteral(value.toISOString())}::${pgType}`;
  }
  switch (typeof value) {
    case "string":
      return pgType === "text" ? stringLiteral(value) : `${stringLiteral(value)}::${pgType}`;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`Default of field ${label} is not a finite number.`);
      }
      return String(value);
    case "boolean":
      return value ? "TRUE" : "FALSE";
    default:
      throw new Error(`Default of field ${label} cannot be rendered as a SQL literal.`);
  }
}

const CURRENT_TIME_EXPRESSIONS = new Map([
  ["datetime", "now()"],
  ["date", "CURRENT_DATE"],
  ["time", "LOCALTIME"],
]);

function defaultExpression(field: DDLFieldConfig, label: string): string {
  const value = field.default;
  const currentTime = CURRENT_TIME_EXPRESSIONS.get(field.type);
  if (value === "now" && currentTime !== undefined) {
    return currentTime;
  }
  if (field.array) {
    if (!Array.isArray(value)) {
      throw new Error(`Default of array field ${label} must be an array.`);
    }
    const pgType = columnType(field);
    if (value.length === 0) return `'{}'::${pgType}`;
    return `ARRAY[${value.map((v) => scalarLiteral(v, field, label)).join(", ")}]::${pgType}`;
  }
  return scalarLiteral(value, field, label);
}

interface SerialFormat {
  prefix: string;
  width: number;
  zeroPad: boolean;
  conversion: "d" | "x" | "X";
  suffix: string;
}

// printf-style with exactly one conversion specifier; octal has no Postgres
// formatting function to stand in for it.
function parseSerialFormat(format: string, label: string): SerialFormat {
  const match =
    /^(?<prefix>[^%]*)%(?<zero>0?)(?<width>\d*)(?<conversion>[a-zA-Z])(?<suffix>[^%]*)$/.exec(
      format,
    );
  const groups = match?.groups;
  const conversion = groups?.conversion;
  if (!groups || (conversion !== "d" && conversion !== "x" && conversion !== "X")) {
    throw new Error(
      `Serial format "${format}" of field ${label} is not supported; use a single %d, %x, or %X specifier with an optional width (e.g. "INV-%05d").`,
    );
  }
  return {
    prefix: groups.prefix ?? "",
    zeroPad: groups.zero === "0",
    width: groups.width ? Number(groups.width) : 0,
    conversion,
    suffix: groups.suffix ?? "",
  };
}

function sequenceName(tableName: string, fieldName: string): string {
  return `${tableName}_${fieldName}_seq`;
}

// A sequence's minimum defaults to 1, which rejects a start of 0.
function sequenceRange(serial: NonNullable<DDLFieldConfig["serial"]>): string {
  const range = [`START WITH ${serial.start}`, `MINVALUE ${serial.start}`];
  if (serial.maxValue !== undefined) range.push(`MAXVALUE ${serial.maxValue}`);
  return range.join(" ");
}

const SERIAL_CONVERSIONS: Record<SerialFormat["conversion"], (nextval: string) => string> = {
  d: (nextval) => nextval,
  x: (nextval) => `to_hex(${nextval})`,
  X: (nextval) => `upper(to_hex(${nextval}))`,
};

function serialStringDefault(sequence: string, format: string | undefined, label: string): string {
  const nextval = `nextval(${stringLiteral(derivedIdentifier(sequence))})`;
  if (format === undefined) return `(${nextval}::text)`;
  const { prefix, width, zeroPad, conversion, suffix } = parseSerialFormat(format, label);
  const number = SERIAL_CONVERSIONS[conversion](nextval);
  let value = conversion === "d" ? `${number}::text` : number;
  if (width > 0) {
    value = `format('%${width}s', ${number})`;
    if (zeroPad) value = `translate(${value}, ' ', '0')`;
  }
  const parts = [
    ...(prefix ? [stringLiteral(prefix)] : []),
    value,
    ...(suffix ? [stringLiteral(suffix)] : []),
  ];
  return `(${parts.join(" || ")})`;
}

function columnDefinition(tableName: string, fieldName: string, field: DDLFieldConfig): string {
  const column = identifier(fieldName);
  const label = `${identifier(tableName)}.${column}`;
  const parts = [column, columnType(field)];

  if (field.serial) {
    if (field.type === "integer") {
      parts.push(`GENERATED BY DEFAULT AS IDENTITY (${sequenceRange(field.serial)})`);
      if (field.unique) parts.push("UNIQUE");
      return parts.join(" ");
    }
    if (field.required) parts.push("NOT NULL");
    if (field.unique) parts.push("UNIQUE");
    parts.push(
      `DEFAULT ${serialStringDefault(sequenceName(tableName, fieldName), field.serial.format, label)}`,
    );
    return parts.join(" ");
  }

  const hasDefault = field.default !== undefined;
  const filledOnCreate = field.hooks?.create !== undefined || field.optionalOnCreate === true;
  if (field.required && (hasDefault || !filledOnCreate)) parts.push("NOT NULL");
  if (field.unique) parts.push("UNIQUE");
  if (hasDefault) parts.push(`DEFAULT ${defaultExpression(field, label)}`);
  return parts.join(" ");
}

/**
 * DDL statements that create one table: any sequences its string serial
 * fields draw from, the table, then its unique indexes. Every statement is
 * `IF NOT EXISTS`, so re-applying the script on a database that already
 * has the table is a no-op. Index names end in `_idx` so they cannot take
 * the `<table>_<column>_key` name Postgres gives a UNIQUE column, which
 * `IF NOT EXISTS` would otherwise silently skip.
 * @param table - Table name, fields, and indexes
 * @returns Statements in execution order, without trailing semicolons
 * @throws If a field type, default, or serial format cannot be expressed
 */
export function generateTableDDL(table: DDLTableConfig): string[] {
  const tableIdentifier = identifier(table.name);
  const sequences: string[] = [];
  const columns = [`  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()`];

  for (const [fieldName, field] of Object.entries(table.fields)) {
    if (fieldName === "id") continue;
    if (field.serial && field.type !== "integer") {
      sequences.push(
        `CREATE SEQUENCE IF NOT EXISTS ${derivedIdentifier(sequenceName(table.name, fieldName))} ${sequenceRange(field.serial)}`,
      );
    }
    columns.push(`  ${columnDefinition(table.name, fieldName, field)}`);
  }

  const indexes = Object.entries(table.indexes ?? {})
    .filter(([, index]) => index.unique)
    .map(
      ([name, index]) =>
        `CREATE UNIQUE INDEX IF NOT EXISTS ${derivedIdentifier(`${table.name}_${name}_idx`)} ON ${tableIdentifier} (${index.fields.map(identifier).join(", ")})`,
    );

  return [
    ...sequences,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier} (\n${columns.join(",\n")}\n)`,
    ...indexes,
  ];
}

/**
 * A single SQL script creating every given table, for `pglite.exec()`.
 * @param tables - Tables in the order to create them
 * @returns The script, empty when there are no tables
 */
export function generateSchemaDDL(tables: readonly DDLTableConfig[]): string {
  return tables
    .map((table) =>
      generateTableDDL(table)
        .map((statement) => `${statement};`)
        .join("\n"),
    )
    .join("\n\n");
}

/** One namespace's tables, as the schema module groups them. */
export interface PgliteSchemaNamespace {
  namespace: string;
  tables: readonly DDLTableConfig[];
}

/** Options for {@link generatePgliteSchemaModule}. */
export interface PgliteSchemaModuleOptions {
  /** Named in the generated header as the producer users must not edit around. */
  generatedBy: string;
}

// A template literal keeps line feeds but folds a carriage return into one.
function templateLiteral(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${")
    .replaceAll("\r", "\\r");
  return `\`${escaped}\``;
}

/**
 * Render the module that exports each namespace's `CREATE TABLE` script for
 * `pglite.exec()`.
 * @param namespaces - Namespaces with the tables to create
 * @param options - Header wording
 * @returns TypeScript source of the schema module
 */
export function generatePgliteSchemaModule(
  namespaces: readonly PgliteSchemaNamespace[],
  options: PgliteSchemaModuleOptions,
): string {
  const entries = namespaces.map(
    ({ namespace, tables }) =>
      `  ${JSON.stringify(namespace)}: ${templateLiteral(generateSchemaDDL(tables))},`,
  );
  return [
    "/**",
    " * Auto-generated PGlite schema for TailorDB tables.",
    " * Create a namespace's tables in a test with `pglite.exec(pgliteSchema[namespace])`.",
    " *",
    ` * DO NOT EDIT - This file is auto-generated by ${options.generatedBy}.`,
    " */",
    "",
    "export const pgliteSchema = {",
    ...entries,
    "} as const;",
    "",
  ].join("\n");
}
