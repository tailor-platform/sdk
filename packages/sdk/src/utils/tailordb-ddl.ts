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
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
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

function derivedName(tableName: string, memberName: string, kind: "seq" | "idx" | "fk"): string {
  const suffix = `_${fnv1aHex(JSON.stringify([tableName, memberName, kind]))}_${kind}`;
  let head = `${tableName}_${memberName}`;
  while (utf8.encode(head + suffix).length > MAX_IDENTIFIER_BYTES) head = head.slice(0, -1);
  return head + suffix;
}

function derivedIdentifier(
  tableName: string,
  memberName: string,
  kind: "seq" | "idx" | "fk",
): string {
  return identifier(derivedName(tableName, memberName, kind));
}

function dollarQuoted(body: string): string {
  let tag = "$fk$";
  while (body.includes(tag)) tag = `${tag.slice(0, -1)}_$`;
  return `${tag}\n${body}\n${tag}`;
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
  return derivedIdentifier(tableName, fieldName, "seq");
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
  const nextval = `nextval(${stringLiteral(sequence)})`;
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

interface Reference {
  /** Column holding the reference */
  column: string;
  /** JSONPath from the column value to each referencing value; `$` for a scalar column */
  path: string;
  table: string;
  field: string;
  /** TailorDB type of the referencing value */
  type: string;
}

function jsonPathKey(key: string): string {
  return `"${key.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function referencesWithin(column: string, field: DDLFieldConfig, path: string): Reference[] {
  const here = field.array ? `${path}[*]` : path;
  if (field.type === "nested") {
    return Object.entries(field.fields ?? {}).flatMap(([key, child]) =>
      referencesWithin(column, child, `${here}.${jsonPathKey(key)}`),
    );
  }
  if (!field.foreignKey || field.foreignKeyType === undefined) return [];
  return [
    {
      column,
      path: here,
      table: field.foreignKeyType,
      field: field.foreignKeyField ?? "id",
      type: field.type,
    },
  ];
}

// The platform indexes a unique member of a nested object by the value at its
// path, cast to the member's type. Members inside an array have no single value
// to index, so they are left out.
const CASTABLE_UNIQUE_TYPES = new Set(["integer", "float", "decimal", "boolean", "bool", "uuid"]);

interface NestedUniqueMember {
  column: string;
  path: string[];
  type: string;
}

function nestedUniqueMembers(
  column: string,
  field: DDLFieldConfig,
  path: string[],
): NestedUniqueMember[] {
  if (field.array) return [];
  if (field.type === "nested") {
    return Object.entries(field.fields ?? {}).flatMap(([key, child]) =>
      nestedUniqueMembers(column, child, [...path, key]),
    );
  }
  return field.unique && path.length > 0 ? [{ column, path, type: field.type }] : [];
}

function nestedUniqueIndex(tableName: string, member: NestedUniqueMember): string {
  const keys = member.path.map(stringLiteral).join(", ");
  const value = `${identifier(member.column)} #>> ARRAY[${keys}]`;
  const indexed = CASTABLE_UNIQUE_TYPES.has(member.type)
    ? `CAST(${value} AS ${mapFieldTypeToPostgresType(member.type)})`
    : value;
  const name = derivedIdentifier(tableName, `${member.column}.${member.path.join(".")}`, "idx");
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${identifier(tableName)} ((${indexed}))`;
}

function tableReferences(table: DDLTableConfig): Reference[] {
  return Object.entries(table.fields)
    .filter(([fieldName]) => fieldName !== "id")
    .flatMap(([fieldName, field]) => referencesWithin(fieldName, field, "$"));
}

// Postgres cannot reference from an array or jsonb column, nor from a column
// whose type differs from the referenced one (a string field related to id),
// so only a plain column of the same storage type becomes a FOREIGN KEY constraint.
function isConstraintReference(
  reference: Reference,
  tables: ReadonlyMap<string, DDLTableConfig>,
): boolean {
  if (reference.path !== "$") return false;
  const targetType =
    reference.field === "id" ? "uuid" : tables.get(reference.table)?.fields[reference.field]?.type;
  return (
    targetType === undefined ||
    mapFieldTypeToPostgresType(targetType) === mapFieldTypeToPostgresType(reference.type)
  );
}

function referenceClause(reference: Reference): string {
  return `REFERENCES ${identifier(reference.table)} (${identifier(reference.field)})`;
}

function declaredType(type: string): string {
  return type === "bool" ? "boolean" : type;
}

type ReferenceCheck = { pgType: string } | { problem: string };

function checkReference(
  reference: Reference,
  tables: ReadonlyMap<string, DDLTableConfig>,
): ReferenceCheck {
  const target = tables.get(reference.table);
  if (!target) return { problem: `references unknown table "${reference.table}".` };
  const targetField =
    reference.field === "id" ? { type: "uuid", unique: true } : target.fields[reference.field];
  if (!targetField) {
    return {
      problem: `references unknown field "${reference.field}" of table "${reference.table}".`,
    };
  }
  const sameType =
    reference.field === "id" || declaredType(targetField.type) === declaredType(reference.type);
  if (!targetField.unique || !sameType) {
    return {
      problem: `references "${reference.table}"."${reference.field}", which must be unique and of the same type as the referencing field.`,
    };
  }
  return { pgType: mapFieldTypeToPostgresType(targetField.type) };
}

function referencedColumnType(
  reference: Reference,
  tables: ReadonlyMap<string, DDLTableConfig>,
  label: string,
): string {
  const check = checkReference(reference, tables);
  if ("problem" in check) throw new Error(`Field ${label} ${check.problem}`);
  return check.pgType;
}

/**
 * The field without the relation it declares.
 * @param field - A field config
 * @returns The field with its foreign key settings removed
 */
export function withoutReference(field: DDLFieldConfig): DDLFieldConfig {
  const {
    foreignKey: _foreignKey,
    foreignKeyType: _type,
    foreignKeyField: _field,
    ...rest
  } = field;
  return rest;
}

function withoutUnresolvableReference(
  field: DDLFieldConfig,
  tables: ReadonlyMap<string, DDLTableConfig>,
): DDLFieldConfig {
  if (field.fields) {
    return {
      ...field,
      fields: Object.fromEntries(
        Object.entries(field.fields).map(([name, child]) => [
          name,
          withoutUnresolvableReference(child, tables),
        ]),
      ),
    };
  }
  if (!field.foreignKey || field.foreignKeyType === undefined) return field;
  const reference = {
    column: "",
    path: "$",
    table: field.foreignKeyType,
    field: field.foreignKeyField ?? "id",
    type: field.type,
  };
  return "problem" in checkReference(reference, tables) ? withoutReference(field) : field;
}

/**
 * Remove the references the given tables cannot satisfy: a target table or
 * field that is missing, not unique, or of another type than the referencing
 * field. {@link generateSchemaDDL} rejects such references, so this lets a
 * schema that is only partly consistent still render, minus those references.
 * @param tables - Tables of one schema
 * @returns The tables, with unsatisfiable references removed from their fields
 */
export function dropUnresolvableReferences(tables: readonly DDLTableConfig[]): DDLTableConfig[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  return tables.map((table) => ({
    ...table,
    fields: Object.fromEntries(
      Object.entries(table.fields).map(([name, field]) => [
        name,
        withoutUnresolvableReference(field, byName),
      ]),
    ),
  }));
}

function referenceCheck(
  reference: Reference,
  tables: ReadonlyMap<string, DDLTableConfig>,
  label: string,
): string {
  const pgType = referencedColumnType(reference, tables, label);
  const comparison =
    pgType === mapFieldTypeToPostgresType(reference.type)
      ? `parent.${identifier(reference.field)} = (fk_check.v #>> '{}')::${pgType}`
      : `parent.${identifier(reference.field)}::text = (fk_check.v #>> '{}')`;
  const target = `${identifier(reference.table)}.${identifier(reference.field)}`;
  const message = `violates foreign key constraints: % not found in ${target.replaceAll("%", "%%")}`;
  return [
    `  FOR v IN SELECT jsonb_path_query(to_jsonb(NEW.${identifier(reference.column)}), ${stringLiteral(reference.path)}) LOOP`,
    `    IF jsonb_typeof(fk_check.v) <> 'null' AND NOT EXISTS (SELECT 1 FROM ${identifier(reference.table)} AS parent WHERE ${comparison}) THEN`,
    `      RAISE EXCEPTION ${stringLiteral(message)}, fk_check.v #>> '{}' USING ERRCODE = 'foreign_key_violation';`,
    "    END IF;",
    "  END LOOP;",
  ].join("\n");
}

function referenceTrigger(
  table: DDLTableConfig,
  references: readonly Reference[],
  tables: ReadonlyMap<string, DDLTableConfig>,
): string[] {
  if (references.length === 0) return [];
  const name = derivedIdentifier(table.name, "references", "fk");
  const checks = references.map((reference) =>
    referenceCheck(reference, tables, `${table.name}.${reference.column}`),
  );
  const body = [
    "<<fk_check>>",
    "DECLARE v jsonb;",
    "BEGIN",
    ...checks,
    "  RETURN NULL;",
    "END",
  ].join("\n");
  return [
    `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS ${dollarQuoted(body)}`,
    `CREATE OR REPLACE TRIGGER ${name} AFTER INSERT OR UPDATE ON ${identifier(table.name)} FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  ];
}

/** What {@link generateTableDDL} needs to know about the other tables of the schema. */
export interface TableDDLOptions {
  /** Every table of the schema, to resolve the types referenced columns point at */
  tables?: readonly DDLTableConfig[];
  /** Columns whose FOREIGN KEY is added after all tables exist, because the target is created later */
  deferredReferences?: ReadonlySet<string>;
}

/**
 * DDL statements that create one table: any sequences its string serial
 * fields draw from, the table, the sequences' ownership of their columns,
 * its unique indexes, then a trigger checking the references Postgres cannot
 * express as a FOREIGN KEY (inside array and nested columns). Every statement
 * is `IF NOT EXISTS` or otherwise idempotent, so re-applying the script on a
 * database that already has the table is a no-op. Owning a sequence makes
 * `DROP TABLE` drop it and `TRUNCATE ... RESTART IDENTITY` reset it to the
 * configured start. Index names end in `_idx` so they cannot take the
 * `<table>_<column>_key` name Postgres gives a UNIQUE column, which
 * `IF NOT EXISTS` would otherwise silently skip.
 * @param table - Table name, fields, and indexes
 * @param options - The schema's other tables, and references to leave to later statements
 * @returns Statements in execution order, without trailing semicolons
 * @throws If a field type, default, or serial format cannot be expressed
 */
export function generateTableDDL(table: DDLTableConfig, options: TableDDLOptions = {}): string[] {
  const tableIdentifier = identifier(table.name);
  const tables = new Map((options.tables ?? [table]).map((t) => [t.name, t]));
  const sequences: string[] = [];
  const ownerships: string[] = [];
  const columns = [`  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()`];
  const references = tableReferences(table);
  const constraintReferences = new Map(
    references.filter((r) => isConstraintReference(r, tables)).map((r) => [r.column, r]),
  );

  for (const [fieldName, field] of Object.entries(table.fields)) {
    if (fieldName === "id") continue;
    if (field.serial && field.type !== "integer") {
      const sequence = sequenceName(table.name, fieldName);
      sequences.push(`CREATE SEQUENCE IF NOT EXISTS ${sequence} ${sequenceRange(field.serial)}`);
      ownerships.push(
        `ALTER SEQUENCE ${sequence} OWNED BY ${tableIdentifier}.${identifier(fieldName)}`,
      );
    }
    const constraint = constraintReferences.get(fieldName);
    const inline =
      constraint && !options.deferredReferences?.has(fieldName)
        ? ` ${referenceClause(constraint)}`
        : "";
    columns.push(`  ${columnDefinition(table.name, fieldName, field)}${inline}`);
  }

  const indexes = [
    ...Object.entries(table.indexes ?? {})
      .filter(([, index]) => index.unique)
      .map(
        ([name, index]) =>
          `CREATE UNIQUE INDEX IF NOT EXISTS ${derivedIdentifier(table.name, name, "idx")} ON ${tableIdentifier} (${index.fields.map(identifier).join(", ")})`,
      ),
    ...Object.entries(table.fields)
      .filter(([fieldName]) => fieldName !== "id")
      .flatMap(([fieldName, field]) => nestedUniqueMembers(fieldName, field, []))
      .map((member) => nestedUniqueIndex(table.name, member)),
  ];

  for (const reference of constraintReferences.values()) {
    referencedColumnType(reference, tables, `${table.name}.${reference.column}`);
  }

  return [
    ...sequences,
    `CREATE TABLE IF NOT EXISTS ${tableIdentifier} (\n${columns.join(",\n")}\n)`,
    ...ownerships,
    ...indexes,
    ...referenceTrigger(
      table,
      references.filter((r) => !isConstraintReference(r, tables)),
      tables,
    ),
  ];
}

function addForeignKey(table: DDLTableConfig, reference: Reference): string {
  const name = derivedName(table.name, reference.column, "fk");
  const tableIdentifier = identifier(table.name);
  const body = [
    "BEGIN",
    `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ${stringLiteral(name)} AND conrelid = ${stringLiteral(tableIdentifier)}::regclass) THEN`,
    `ALTER TABLE ${tableIdentifier} ADD CONSTRAINT ${identifier(name)} FOREIGN KEY (${identifier(reference.column)}) ${referenceClause(reference)};`,
    "END IF;",
    "END",
  ].join("\n");
  return `DO ${dollarQuoted(body)}`;
}

// Tables come after the tables they reference. Where references form a cycle,
// the first table of the cycle is created without the constraint that points
// at a table not yet created, and the constraint is added once all tables exist.
function planCreation(tables: readonly DDLTableConfig[]): {
  ordered: DDLTableConfig[];
  deferred: Map<DDLTableConfig, Reference[]>;
} {
  const names = new Set(tables.map((table) => table.name));
  const byName = new Map(tables.map((table) => [table.name, table]));
  const created = new Set<string>();
  const remaining = [...tables];
  const ordered: DDLTableConfig[] = [];
  const deferred = new Map<DDLTableConfig, Reference[]>();
  const pendingOf = (table: DDLTableConfig) =>
    tableReferences(table)
      .filter((r) => isConstraintReference(r, byName))
      .filter((r) => names.has(r.table) && r.table !== table.name && !created.has(r.table));
  while (remaining.length > 0) {
    const index = remaining.findIndex((table) => pendingOf(table).length === 0);
    const [table] = remaining.splice(Math.max(index, 0), 1) as [DDLTableConfig];
    const pending = pendingOf(table);
    if (pending.length > 0) deferred.set(table, pending);
    created.add(table.name);
    ordered.push(table);
  }
  return { ordered, deferred };
}

/**
 * A single SQL script creating every given table, for `pglite.exec()`. Tables
 * are created after the tables they reference.
 * @param tables - Tables to create
 * @returns The script, empty when there are no tables
 * @throws If a field references a table or field that is not among the tables
 */
export function generateSchemaDDL(tables: readonly DDLTableConfig[]): string {
  const { ordered, deferred } = planCreation(tables);
  const statements = ordered.map((table) =>
    generateTableDDL(table, {
      tables,
      deferredReferences: new Set(deferred.get(table)?.map((r) => r.column)),
    }),
  );
  const constraints = ordered.flatMap((table) =>
    (deferred.get(table) ?? []).map((reference) => addForeignKey(table, reference)),
  );
  return [...statements, constraints]
    .filter((group) => group.length > 0)
    .map((group) => group.map((statement) => `${statement};`).join("\n"))
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
