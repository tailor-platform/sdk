import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "#/utils/field-column-type";
import {
  ARITHMETIC_OPERATORS,
  parseSql,
  PATTERN_OPERATORS,
  type SqlAggregate,
  type SqlColumnRef,
  type SqlDiagnostic,
  type SqlExpression,
  type SqlIdentifier,
  type SqlJoin,
  type SqlLiteral,
  type SqlParam,
  type SqlSelectItem,
  type SqlSetOperand,
  type SqlSpan,
  type SqlStatement,
  type SqlTableRef,
  type SqlValue,
} from "./parser";
import type { SqlCardinality } from "#/runtime/sql";

/** The parts of a TailorDB field definition the analysis reads. */
interface SqlFieldConfig {
  type: string;
  required?: boolean;
  array?: boolean;
  unique?: boolean;
  vector?: boolean;
  allowedValues?: { value: string }[];
  fields?: Record<string, SqlFieldConfig>;
  hooks?: { update?: unknown };
}

const SQL_FIELD_KEYS = Object.keys({
  type: true,
  required: true,
  array: true,
  unique: true,
  vector: true,
  allowedValues: true,
  fields: true,
  hooks: true,
} satisfies Record<keyof SqlFieldConfig, true>) as (keyof SqlFieldConfig)[];

/** The parts of a parsed TailorDB table the analysis reads. */
interface SqlTableDefinition {
  name: string;
  fields: Record<string, { config: SqlFieldConfig }>;
  indexes?: Record<string, { fields: string[]; unique?: boolean }>;
  typeHookExpr?: { update?: string };
}

/** The TailorDB tables statements are checked against. */
export interface SqlDefinitions {
  namespaces: ReadonlyMap<string, readonly SqlTableDefinition[]>;
  /** Whether date/datetime/time values come back as Temporal objects. */
  temporal: boolean;
}

/** A named TypeScript type: a parameter or a result column. */
export interface SqlTypedName {
  name: string;
  type: string;
}

/** What a statement takes and returns. */
export interface SqlAnalysis {
  namespace: string;
  /** The statement as sent, each `:name` replaced by `$n`. */
  text: string;
  /** The placeholder name each `$n` of {@link SqlAnalysis.text} binds, in order. */
  paramNames: string[];
  /** Each distinct placeholder, in order of first appearance. */
  params: SqlTypedName[];
  columns: SqlTypedName[];
  cardinality: SqlCardinality;
  /** Whether a type references `Temporal`. */
  usesTemporal: boolean;
}

export interface SqlAnalysisResult {
  analysis?: SqlAnalysis;
  diagnostics: SqlDiagnostic[];
}

const ID_FIELD: SqlFieldConfig = { type: "uuid", required: true, unique: true };
const NUMERIC_TYPES = ["integer", "float", "decimal"];
const COMPARABLE_TYPES = [...NUMERIC_TYPES, "string", "enum", "date", "time", "datetime"];
// Arithmetic yields the first of these its operands include.
const ARITHMETIC_RESULT_TYPES = ["float", "decimal", "integer"];
const ARITHMETIC = new Set(ARITHMETIC_OPERATORS);
const COMPARISON_OPERATORS = new Set(["=", "<>", "<", "<=", ">", ">="]);
const REGEX_OPERATORS = new Set(["~", "!~", "~*", "!~*"]);
const PATTERNS = new Set<string>(PATTERN_OPERATORS);
const INTEGER_LITERAL = /^[+-]?[0-9]+$/;
const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INT32_MAX = 2147483647;
const TYPE_LABELS: Readonly<Record<string, string>> = {
  integer: "Integer",
  float: "Float",
  decimal: "Decimal",
  string: "String",
  enum: "Enum",
  date: "Date",
  time: "Time",
  datetime: "DateTime",
  boolean: "Boolean",
  uuid: "UUID",
  nested: "nested object",
};

interface Table {
  definition: SqlTableDefinition;
  namespace: string;
  fields: Map<string, SqlFieldConfig>;
}

interface Source {
  table: Table;
  name: string;
  nullable: boolean;
}

/** The type TailorDB gives a value: a field's, or one it derives for an expression. */
interface Schema {
  /** `required` says whether TailorDB rejects NULL for it, as for a placeholder bound to it. */
  config: SqlFieldConfig;
  /** The name TailorDB gives the value as a result column. */
  name: string;
}

/** A select-list value: its schema, and whether a row can hold NULL for it. */
interface Selected {
  schema: Schema;
  nullable: boolean;
}

/** A condition operand: typed, typed by its context (a placeholder, string or NULL), or broken. */
type Operand =
  | { kind: "typed"; schema: Schema; node: SqlExpression }
  | { kind: "untyped"; node: SqlParam | SqlLiteral }
  | { kind: "broken" };

/** A joined table, with its join's kind and condition. */
interface JoinedSource {
  type: SqlJoin["type"];
  on?: SqlExpression;
  source: Source;
}

function schemaOf(type: string, name = "?column?"): Schema {
  return { config: { type }, name };
}

const BOOLEAN = schemaOf("boolean");
const STRING = schemaOf("string");

function quoteName(name: string): string {
  return `"${name}"`;
}

/**
 * Write a name as an object type's property key, quoting it when it is not an identifier.
 * @param name - Property name
 * @returns The key as written in a type
 */
export function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function nullable(type: string): string {
  return `${type} | null`;
}

function listOf(items: readonly string[], conjunction: string): string {
  const rest = items.slice(0, -1);
  const last = items.at(-1) ?? "";
  return rest.length > 0 ? `${rest.join(", ")} ${conjunction} ${last}` : last;
}

function fieldOfTypes(types: readonly string[]): string {
  const list = listOf(
    types.map((type) => TYPE_LABELS[type] ?? type),
    "or",
  );
  return `${/^[AEIOU]/.test(list) ? "an" : "a"} ${list} field`;
}

function typeOf(config: SqlFieldConfig): string {
  return `${config.type}${config.array ? "[]" : ""}`;
}

function sameType(a: SqlFieldConfig, b: SqlFieldConfig): boolean {
  return a.type === b.type && Boolean(a.array) === Boolean(b.array);
}

function isNumeric(config: SqlFieldConfig): boolean {
  return !config.array && NUMERIC_TYPES.includes(config.type);
}

function isTextual(config: SqlFieldConfig): boolean {
  return !config.array && (config.type === "string" || config.type === "enum");
}

function isInt32(text: string): boolean {
  return (
    INTEGER_LITERAL.test(text) &&
    Math.abs(Number(text)) <= INT32_MAX + (text.startsWith("-") ? 1 : 0)
  );
}

// The columns without whose value an expression's value is null.
function nullPropagatingColumns(expr: SqlExpression): SqlColumnRef[] {
  if (expr.kind === "column") return [expr];
  if (expr.kind === "unary" && expr.op !== "NOT") return nullPropagatingColumns(expr.operand);
  if (expr.kind === "binary" && ARITHMETIC.has(expr.op)) {
    return [...nullPropagatingColumns(expr.left), ...nullPropagatingColumns(expr.right)];
  }
  return [];
}

// The column references of an expression, outside aggregates.
function columnsOf(expr: SqlExpression): SqlColumnRef[] {
  switch (expr.kind) {
    case "column":
      return [expr];
    case "unary":
      return columnsOf(expr.operand);
    case "binary":
      return [...columnsOf(expr.left), ...columnsOf(expr.right)];
    case "in":
      return [expr.left, ...expr.items].flatMap(columnsOf);
    case "between":
      return [expr.left, expr.low, expr.high].flatMap(columnsOf);
    case "isNull":
      return columnsOf(expr.left);
    default:
      return [];
  }
}

// Whether an expression has the same value on every row: literals, placeholders and arithmetic of them.
function isFixed(expr: SqlExpression): boolean {
  if (expr.kind === "param" || expr.kind === "literal" || expr.kind === "array") return true;
  if (expr.kind === "unary" && expr.op !== "NOT") return isFixed(expr.operand);
  if (expr.kind === "binary" && ARITHMETIC.has(expr.op)) {
    return isFixed(expr.left) && isFixed(expr.right);
  }
  return false;
}

// The name TailorDB gives a result column that has no alias.
function defaultName(expr: SqlExpression): string {
  switch (expr.kind) {
    case "column":
      return expr.column.name;
    case "aggregate":
      return expr.fn;
    case "unary":
      return defaultName(expr.operand);
    case "binary":
      return "expression";
    default:
      return "?column?";
  }
}

function describeSource(source: Source): string {
  const table = quoteName(source.table.definition.name);
  return source.name === source.table.definition.name ? table : `${table} ${source.name}`;
}

const DATE = String.raw`[+-]?\d{4,}-\d{1,2}-\d{1,2}`;
const TIME = String.raw`\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?`;
const DATE_TIME = new RegExp(
  String.raw`^${DATE}(?:[Tt ]${TIME}(?:[Zz]|[+-]\d{1,2}(?::?\d{2})?)?)?$`,
);
const TIME_ONLY = new RegExp(`^${TIME}$`);

function validDate(text: string): boolean {
  const match = /^[+-]?(\d+)-(\d+)-(\d+)/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(2000, month - 1, day));
  return month >= 1 && month <= 12 && date.getUTCDate() === day && year >= 0;
}

function validTime(text: string): boolean {
  const [hour = 0, minute = 0, second = 0] = text.split(":").map(Number);
  return hour < 24 && minute < 60 && second < 61;
}

// Split PostgreSQL array text such as `{a,"b c"}`, or undefined when it is malformed.
function arrayElements(text: string): string[] | undefined {
  const body = /^\s*\{(.*)\}\s*$/s.exec(text)?.[1];
  if (body === undefined) return undefined;
  if (body.trim() === "") return [];
  const elements: string[] = [];
  let i = 0;
  for (;;) {
    while (/\s/.test(body.charAt(i))) i++;
    let element = "";
    if (body[i] === '"') {
      for (i++; body[i] !== '"'; i++) {
        if (i >= body.length) return undefined;
        if (body[i] === "\\") i++;
        element += body.charAt(i);
      }
      i++;
      while (/\s/.test(body.charAt(i))) i++;
    } else {
      for (; i < body.length && body[i] !== ","; i++) {
        if (body[i] === "{" || body[i] === '"') return undefined;
        if (body[i] === "\\") i++;
        element += body.charAt(i);
      }
      element = element.trimEnd();
      if (element === "" || element.toUpperCase() === "NULL") return undefined;
    }
    elements.push(element);
    if (i >= body.length) return elements;
    if (body[i] !== ",") return undefined;
    i++;
  }
}

// Why `text` is not a value of `config` as TailorDB reads text, or undefined when it is one.
function textProblem(config: SqlFieldConfig, text: string): string | undefined {
  if (config.array) {
    const elements = arrayElements(text);
    if (!elements) return "is not array text such as {a,b}";
    const element = { ...config, array: false };
    for (const value of elements) {
      const problem = textProblem(element, value);
      if (problem) return problem;
    }
    return undefined;
  }
  const valid = (() => {
    switch (config.type) {
      case "uuid":
        return /^(?:urn:uuid:)?\{?[0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}\}?$/i.test(text);
      case "boolean":
        return /^(?:t|true|f|false)$/i.test(text);
      case "integer":
        return isInt32(text);
      case "float":
        return /^[+-]?(?:\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|inf|infinity|nan)$/i.test(
          text,
        );
      case "decimal":
        return NUMBER_TEXT.test(text);
      case "date":
      case "datetime":
        return DATE_TIME.test(text) && validDate(text);
      case "time":
        return TIME_ONLY.test(text) && validTime(text);
      case "enum":
        return (config.allowedValues ?? []).some((v) => v.value === text);
      case "nested":
        return true;
      default:
        return true;
    }
  })();
  if (!valid) {
    if (config.type === "enum") {
      const values = (config.allowedValues ?? []).map((v) => v.value);
      return `is not one of its values: ${values.join(", ")}`;
    }
    return `is not a valid ${TYPE_LABELS[config.type] ?? config.type} value`;
  }
  if (config.type === "nested") {
    try {
      return jsonProblem(config, JSON.parse(text) as unknown);
    } catch {
      return "is not JSON";
    }
  }
  return undefined;
}

// Why a JSON value does not fit a nested field, or undefined when it does.
function jsonProblem(config: SqlFieldConfig, value: unknown): string | undefined {
  if (value === null) return config.required ? "has null for a required field" : undefined;
  if (config.array) {
    if (!Array.isArray(value)) return "has a non-array value for an array field";
    const element = { ...config, array: false, required: true };
    return value.map((item) => jsonProblem(element, item)).find(Boolean);
  }
  if (config.type === "nested") {
    if (typeof value !== "object" || Array.isArray(value)) return "is not a JSON object";
    const object = value as Record<string, unknown>;
    const fields = config.fields ?? {};
    const unknown = Object.keys(object).find((key) => !(key in fields));
    if (unknown !== undefined) return `has the unknown key "${unknown}"`;
    for (const [key, field] of Object.entries(fields)) {
      if (!(key in object)) {
        if (field.required) return `lacks the required key "${key}"`;
        continue;
      }
      const problem = jsonProblem(field, object[key]);
      if (problem) return problem;
    }
    return undefined;
  }
  if (typeof value === "string") {
    return [
      "string",
      "uuid",
      "enum",
      "boolean",
      "integer",
      "float",
      "decimal",
      "date",
      "time",
      "datetime",
    ].includes(config.type)
      ? textProblem(config, value)
      : `has a string for a ${config.type} field`;
  }
  if (typeof value === "number") {
    if (config.type === "integer") {
      return Number.isInteger(value) && Math.abs(value) <= INT32_MAX
        ? undefined
        : "has a number that is not a 32-bit integer";
    }
    return config.type === "float" ? undefined : `has a number for a ${config.type} field`;
  }
  if (typeof value === "boolean") {
    return config.type === "boolean" ? undefined : `has a boolean for a ${config.type} field`;
  }
  return `has an unexpected value for a ${config.type} field`;
}

// Why a regular expression is one TailorDB rejects, or undefined. TailorDB parses patterns with
// Rust's regex syntax and limits nested repetition and repeat bounds.
function regexProblem(pattern: string): string | undefined {
  let i = 0;
  let maxBound = 0;
  const unsupported = (): string | undefined => {
    const lookaround = /^\(\?<?[=!]/.exec(pattern.slice(i));
    if (lookaround) return "uses lookaround";
    return undefined;
  };
  // The nesting depth of repetition in the alternation that starts at `i`.
  const alternation = (): number | string => {
    let height = 0;
    while (i < pattern.length && pattern[i] !== ")") {
      if (pattern[i] === "|") {
        i++;
        continue;
      }
      const atom = atomHeight();
      if (typeof atom === "string") return atom;
      const repeat = quantifier();
      if (typeof repeat === "string") return repeat;
      height = Math.max(height, atom + repeat);
    }
    return height;
  };
  const atomHeight = (): number | string => {
    const c = pattern[i];
    if (c === "(") {
      const problem = unsupported();
      if (problem) return problem;
      i++;
      const flags = /^\?(?:P?<[A-Za-z_][A-Za-z0-9_]*>|[a-zA-Z-]*:?)/.exec(pattern.slice(i));
      if (flags) i += flags[0].length;
      const inner = alternation();
      if (pattern[i] !== ")") return "has an unclosed group";
      i++;
      return inner;
    }
    if (c === "[") {
      let depth = 0;
      do {
        if (pattern[i] === "\\") i++;
        else if (pattern[i] === "[") depth++;
        else if (pattern[i] === "]" && pattern[i - 1] !== "[" && pattern[i - 1] !== "^") depth--;
        i++;
      } while (depth > 0 && i < pattern.length);
      return depth > 0 ? "has an unclosed character class" : 0;
    }
    if (c === "\\") {
      const escaped = pattern.charAt(i + 1);
      if (/[1-9]/.test(escaped)) return "uses a backreference";
      if (/[yYmMZ]/.test(escaped)) return `uses \\${escaped}, which TailorDB does not support`;
      i += 2;
      if (/[pP]/.test(escaped) && pattern[i] === "{") {
        i = pattern.indexOf("}", i) + 1 || pattern.length;
      }
      return 0;
    }
    i++;
    return 0;
  };
  // How much a quantifier at `i` adds to the repetition depth.
  const quantifier = (): number | string => {
    let added = 0;
    for (;;) {
      const counted = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (pattern[i] === "*" || pattern[i] === "+" || pattern[i] === "?") {
        i++;
        added++;
      } else if (counted) {
        i += counted[0].length;
        const min = Number(counted[1]);
        const max =
          counted[2] === undefined ? min : counted[3] === "" ? undefined : Number(counted[3]);
        if (max !== undefined) maxBound = Math.max(maxBound, max);
        if (!(min === 1 && max === 1) && max !== 0) added++;
      } else {
        return added;
      }
      if (pattern[i] === "?") i++;
    }
  };
  const height = alternation();
  if (typeof height === "string") return height;
  if (i < pattern.length) return "has an unmatched )";
  if (height > 1) return "nests repetition, which TailorDB rejects as too complex";
  if (maxBound > 255) return "repeats more than 255 times, which TailorDB rejects as too complex";
  return undefined;
}

class Analyzer {
  readonly diagnostics: SqlDiagnostic[] = [];
  usesTemporal = false;
  readonly #tables = new Map<string, Table>();
  readonly #params = new Map<string, { base: string; nullable: boolean }>();
  // The columns of each source a WHERE test proves not null.
  readonly #notNull = new Map<Source, Set<string>>();
  // Whether the SELECT groups its rows, so that every group an aggregate reads has a row.
  #grouped = false;
  // Aliases joined after the ON being analyzed.
  #later = new Set<string>();
  #namespace: { name: string; table: string } | undefined;

  constructor(
    private readonly definitions: SqlDefinitions,
    private readonly source: string,
  ) {
    for (const [namespace, tables] of definitions.namespaces) {
      for (const definition of tables) {
        const fields = new Map<string, SqlFieldConfig>([["id", ID_FIELD]]);
        for (const [name, field] of Object.entries(definition.fields)) {
          if (name !== "id") fields.set(name, field.config);
        }
        this.#tables.set(definition.name, { definition, namespace, fields });
      }
    }
  }

  get namespace(): string | undefined {
    return this.#namespace?.name;
  }

  report(message: string, span: SqlSpan): void {
    const length = span.end - span.start;
    const repeated = this.diagnostics.some(
      (d) => d.message === message && d.start === span.start && d.length === length,
    );
    if (!repeated) this.diagnostics.push({ message, start: span.start, length });
  }

  #text(span: SqlSpan): string {
    return this.source.slice(span.start, span.end);
  }

  type(config: SqlFieldConfig, mode: "select" | "write", nested = false): string {
    let base: string;
    if (config.type === "enum") {
      base = (config.allowedValues ?? []).map((v) => JSON.stringify(v.value)).join(" | ");
    } else if (config.type === "nested") {
      const members = Object.entries(config.fields ?? {}).map(([name, field]) =>
        field.required === true
          ? `${propertyKey(name)}: ${this.type(field, mode, true)}`
          : `${propertyKey(name)}?: ${nullable(this.type(field, mode, true))}`,
      );
      base = `{ ${members.join("; ")} }`;
    } else {
      const columnType = mapFieldTypeToColumnType(config.type, this.definitions.temporal, nested);
      if (columnType.startsWith("Temporal")) this.usesTemporal = true;
      base = COLUMN_TYPE_ALIASES.get(columnType)?.[mode] ?? columnType;
    }
    if (!config.array) return base;
    return base.includes(" | ") ? `(${base})[]` : `${base}[]`;
  }

  params(names: string[]): SqlTypedName[] {
    return [...new Set(names)].map((name) => {
      const param = this.#params.get(name);
      if (param === undefined) throw new Error(`No type was inferred for placeholder :${name}`);
      return { name, type: param.nullable ? nullable(param.base) : param.base };
    });
  }

  // Type a placeholder as TailorDB binds it to `schema`: NULL is accepted unless the schema requires a value.
  typeParam(param: SqlParam, schema: Schema): void {
    const { config } = schema;
    const base =
      config.type === "decimal" && !config.array ? "string | number" : this.type(config, "write");
    const existing = this.#params.get(param.name);
    if (!existing) {
      this.#params.set(param.name, { base, nullable: config.required !== true });
    } else if (existing.base !== base) {
      this.report(
        `Placeholder :${param.name} is used as both ${existing.base} and ${base}; use separate placeholders`,
        param.span,
      );
    } else {
      existing.nullable &&= config.required !== true;
    }
  }

  table(identifier: SqlIdentifier): Table | undefined {
    const table = this.#tables.get(identifier.name);
    if (!table) {
      const similar = [...this.#tables.keys()].find(
        (name) => name.toLowerCase() === identifier.name.toLowerCase(),
      );
      this.report(
        `Table ${quoteName(identifier.name)} is not defined in any TailorDB namespace${similar ? `; did you mean ${quoteName(similar)}?` : ""}`,
        identifier.span,
      );
      return undefined;
    }
    if (!this.#namespace) {
      this.#namespace = { name: table.namespace, table: table.definition.name };
    } else if (this.#namespace.name !== table.namespace) {
      this.report(
        `Query references tables from multiple namespaces: ${[this.#namespace.name, table.namespace].join(", ")}.`,
        identifier.span,
      );
    }
    return table;
  }

  bind(scope: Source[], ref: SqlTableRef): Source | undefined {
    const table = this.table(ref.table);
    if (!table) return undefined;
    const name = ref.alias ?? ref.table;
    if (scope.some((source) => source.name === name.name)) {
      this.report(`Table or alias ${quoteName(name.name)} is used more than once`, name.span);
      return undefined;
    }
    const source = { table, name: name.name, nullable: false };
    scope.push(source);
    return source;
  }

  #missingSource(scope: Source[], identifier: SqlIdentifier): void {
    if (scope.length === 0) return;
    this.report(
      this.#later.has(identifier.name)
        ? `${quoteName(identifier.name)} is joined after this ON, which can only use the tables joined so far`
        : `Table or alias ${quoteName(identifier.name)} is not in the query`,
      identifier.span,
    );
  }

  #missingColumn(column: SqlIdentifier, tables: readonly Table[]): void {
    const [only] = tables;
    const where =
      only && tables.length === 1 ? quoteName(only.definition.name) : "any table of the query";
    this.report(`Column ${quoteName(column.name)} does not exist in ${where}`, column.span);
  }

  fieldOf(table: Table, column: SqlIdentifier): SqlFieldConfig | undefined {
    const config = table.fields.get(column.name);
    if (!config) this.#missingColumn(column, [table]);
    return config;
  }

  column(scope: Source[], ref: SqlColumnRef): (Selected & { source: Source }) | undefined {
    const { candidates, found } = this.#lookup(scope, ref);
    if (found) {
      const { source, config } = found;
      return {
        source,
        schema: { config, name: ref.column.name },
        nullable: this.#nullable(source, ref.column.name, config),
      };
    }
    const [candidate] = candidates;
    if (ref.table) {
      if (candidate) this.#missingColumn(ref.column, [candidate.table]);
      else this.#missingSource(scope, ref.table);
      return undefined;
    }
    if (candidates.length > 1) {
      this.report(
        `Column ${quoteName(ref.column.name)} is ambiguous: it exists in ${listOf(candidates.map(describeSource), "and")}`,
        ref.column.span,
      );
      return undefined;
    }
    if (scope.length > 0) {
      this.#missingColumn(
        ref.column,
        scope.map((source) => source.table),
      );
    }
    return undefined;
  }

  // A column read as a value of a condition, GROUP BY or ORDER BY, which cannot be an array or nested.
  #queryable(scope: Source[], ref: SqlColumnRef): (Selected & { source: Source }) | undefined {
    const column = this.column(scope, ref);
    if (column && !this.#checkQueryable(column.schema.config, ref.column.name, ref.span)) {
      return undefined;
    }
    return column;
  }

  #checkQueryable(config: SqlFieldConfig, name: string, span: SqlSpan): boolean {
    if (!config.array && config.type !== "nested") return true;
    this.report(
      `${config.array ? "The array field" : "The nested field"} ${quoteName(name)} can only be selected or returned in TailorDB SQL`,
      span,
    );
    return false;
  }

  // The sources a column reference may name, and the field when exactly one source holds it.
  #lookup(
    scope: Source[],
    ref: SqlColumnRef,
  ): { candidates: Source[]; found?: { source: Source; config: SqlFieldConfig } } {
    const tableName = ref.table?.name;
    const candidates = scope.filter((source) =>
      tableName === undefined
        ? source.table.fields.has(ref.column.name)
        : source.name === tableName,
    );
    const [source] = candidates;
    const config = candidates.length === 1 ? source?.table.fields.get(ref.column.name) : undefined;
    return { candidates, found: source && config ? { source, config } : undefined };
  }

  #nullable(source: Source, column: string, config: SqlFieldConfig): boolean {
    if (this.#notNull.get(source)?.has(column)) return false;
    return source.nullable || config.required !== true;
  }

  #conjuncts(condition: SqlExpression | undefined): SqlExpression[] {
    if (!condition) return [];
    if (condition.kind !== "binary" || condition.op !== "AND") return [condition];
    return [...this.#conjuncts(condition.left), ...this.#conjuncts(condition.right)];
  }

  // The columns that must hold a value for `condition` to be true, or false when `negated`.
  #requiredColumns(condition: SqlExpression, negated = false): SqlColumnRef[] {
    switch (condition.kind) {
      case "column":
        return [condition];
      case "unary":
        return condition.op === "NOT" ? this.#requiredColumns(condition.operand, !negated) : [];
      case "binary":
        if (condition.op === "AND" || condition.op === "OR") {
          if ((condition.op === "AND") === negated) return [];
          return [
            ...this.#requiredColumns(condition.left, negated),
            ...this.#requiredColumns(condition.right, negated),
          ];
        }
        if (ARITHMETIC.has(condition.op)) return [];
        return [
          ...nullPropagatingColumns(condition.left),
          ...nullPropagatingColumns(condition.right),
        ];
      case "in":
      case "between":
        return nullPropagatingColumns(condition.left);
      case "isNull":
        return condition.not === negated ? [] : nullPropagatingColumns(condition.left);
      default:
        return [];
    }
  }

  // Record the columns `where` needs a value in, except `excluded`.
  narrow(scope: Source[], where: SqlExpression | undefined, excluded?: ReadonlySet<string>): void {
    if (!where) return;
    for (const ref of this.#requiredColumns(where)) {
      const { found } = this.#lookup(scope, ref);
      if (!found) continue;
      found.source.nullable = false;
      if (excluded?.has(ref.column.name)) continue;
      const columns = this.#notNull.get(found.source) ?? new Set<string>();
      this.#notNull.set(found.source, columns.add(ref.column.name));
    }
  }

  // The aggregate's result, or undefined when its argument cannot be aggregated.
  aggregate(scope: Source[], aggregate: SqlAggregate): Selected | undefined {
    const arg = aggregate.arg && this.#scalar(scope, aggregate.arg, "an aggregate");
    if (aggregate.fn === "count") {
      return {
        schema: { config: { type: "integer", required: true }, name: aggregate.fn },
        nullable: false,
      };
    }
    if (!arg) return undefined;
    const name = aggregate.fn.toUpperCase();
    const allowed =
      aggregate.fn === "sum" || aggregate.fn === "avg" ? NUMERIC_TYPES : COMPARABLE_TYPES;
    const { config } = arg.schema;
    if (config.array || !allowed.includes(config.type)) {
      this.report(`${name} takes ${fieldOfTypes(allowed)}, not ${typeOf(config)}`, aggregate.span);
      return undefined;
    }
    const type = aggregate.fn === "avg" && config.type !== "decimal" ? "float" : config.type;
    return {
      schema: {
        config: { type, allowedValues: config.allowedValues },
        name: aggregate.fn,
      },
      nullable: !this.#grouped || arg.nullable,
    };
  }

  // A value of the select list, RETURNING or an aggregate argument (`where`).
  #scalar(scope: Source[], expr: SqlExpression, where: string): Selected | undefined {
    switch (expr.kind) {
      case "column":
        return this.column(scope, expr);
      case "literal": {
        if (expr.type === "null") {
          this.report(`NULL is not supported in ${where}`, expr.span);
          return undefined;
        }
        const type = expr.type === "number" ? this.#numberType(expr, "float") : expr.type;
        if (!type) return undefined;
        return { schema: { config: { type, required: true }, name: "?column?" }, nullable: false };
      }
      case "param":
        this.report(`Placeholders are not supported in ${where}`, expr.span);
        return undefined;
      case "array":
        this.report("Array literals are only supported in VALUES and SET", expr.span);
        return undefined;
      case "aggregate":
        return this.aggregate(scope, expr);
      case "unary": {
        const operand = this.#scalar(scope, expr.operand, where);
        if (!operand) return undefined;
        const text = this.#text(expr.operand.span);
        if (!this.arithmeticOperand(operand.schema.config, text, expr.operand.span)) {
          return undefined;
        }
        return operand;
      }
      case "binary": {
        const left = this.#scalar(scope, expr.left, where);
        const right = this.#scalar(scope, expr.right, where);
        if (!left || !right) return undefined;
        const valid = [
          this.arithmeticOperand(left.schema.config, this.#text(expr.left.span), expr.left.span),
          this.arithmeticOperand(right.schema.config, this.#text(expr.right.span), expr.right.span),
          this.#checkDivisor(expr.op, expr.right),
        ].every(Boolean);
        if (!valid) return undefined;
        const types = [left.schema.config.type, right.schema.config.type];
        const type = ARITHMETIC_RESULT_TYPES.find((t) => types.includes(t)) ?? "integer";
        return {
          schema: { config: { type }, name: "expression" },
          nullable: left.nullable || right.nullable,
        };
      }
      default:
        return undefined;
    }
  }

  // The type of a number literal: an Integer when it has no point or exponent, else `fractional`.
  #numberType(literal: SqlLiteral, fractional: string): string | undefined {
    if (/[.eE]/.test(literal.value)) {
      if (!/^\d*\.?\d*(?:[eE][+-]?\d+)?$/.test(literal.value)) {
        this.report(`${literal.value} is not a number TailorDB SQL reads`, literal.span);
        return undefined;
      }
      return fractional;
    }
    if (!INTEGER_LITERAL.test(literal.value)) {
      this.report(`${literal.value} is not a number TailorDB SQL reads`, literal.span);
      return undefined;
    }
    if (!isInt32(literal.value)) {
      this.report(
        `TailorDB SQL takes integers in the 32-bit range, and ${literal.value} is not`,
        literal.span,
      );
      return undefined;
    }
    return "integer";
  }

  // Whether `operator` does not divide by a literal zero, which fails in TailorDB.
  #checkDivisor(operator: string, expr: SqlExpression): boolean {
    let divisor = expr;
    while (divisor.kind === "unary" && divisor.op !== "NOT") divisor = divisor.operand;
    if (operator !== "/" || divisor.kind !== "literal" || divisor.type !== "number") return true;
    if (Number(divisor.value) !== 0) return true;
    this.report("Dividing by zero fails in TailorDB SQL", expr.span);
    return false;
  }

  arithmeticOperand(config: SqlFieldConfig, name: string, span: SqlSpan): boolean {
    if (isNumeric(config)) return true;
    this.report(
      `Arithmetic needs ${fieldOfTypes(NUMERIC_TYPES)}, and ${name} is ${typeOf(config)}`,
      span,
    );
    return false;
  }

  // Check a condition of WHERE, ON or HAVING, which must be true or false.
  condition(scope: Source[], expr: SqlExpression | undefined, aggregates: boolean): void {
    if (!expr) return;
    this.#resolve(this.#operand(scope, expr, aggregates), BOOLEAN);
  }

  #operand(scope: Source[], expr: SqlExpression, aggregates: boolean): Operand {
    const typed = (schema: Schema): Operand => ({ kind: "typed", schema, node: expr });
    switch (expr.kind) {
      case "column": {
        const column = this.#queryable(scope, expr);
        return column ? typed(column.schema) : { kind: "broken" };
      }
      case "literal":
        if (expr.type === "string" || expr.type === "null") return { kind: "untyped", node: expr };
        if (expr.type === "boolean") return typed(BOOLEAN);
        {
          const type = this.#numberType(expr, "decimal");
          return type ? typed(schemaOf(type)) : { kind: "broken" };
        }
      case "param":
        return { kind: "untyped", node: expr };
      case "array":
        this.report("Array literals are only supported in VALUES and SET", expr.span);
        return { kind: "broken" };
      case "aggregate": {
        if (!aggregates) {
          this.report("Aggregates are only allowed in HAVING and the select list", expr.span);
          return { kind: "broken" };
        }
        const aggregate = this.aggregate(scope, expr);
        return aggregate ? typed(aggregate.schema) : { kind: "broken" };
      }
      case "unary": {
        const operand = this.#operand(scope, expr.operand, aggregates);
        if (expr.op === "NOT") {
          this.#resolve(operand, BOOLEAN);
          return typed(BOOLEAN);
        }
        if (operand.kind === "untyped") {
          this.report("A sign needs a column or a number to know its type", expr.span);
          return { kind: "broken" };
        }
        if (operand.kind === "broken") return operand;
        const text = this.#text(expr.operand.span);
        return this.arithmeticOperand(operand.schema.config, text, expr.operand.span)
          ? typed(operand.schema)
          : { kind: "broken" };
      }
      case "binary":
        return this.#binary(scope, expr, aggregates, typed);
      case "in": {
        const left = this.#typedLeft(this.#operand(scope, expr.left, aggregates), "IN");
        for (const item of expr.items) {
          this.#compare(left, this.#operand(scope, item, aggregates));
        }
        return typed(BOOLEAN);
      }
      case "between": {
        const left = this.#typedLeft(this.#operand(scope, expr.left, aggregates), "BETWEEN");
        this.#compare(left, this.#operand(scope, expr.low, aggregates));
        this.#compare(left, this.#operand(scope, expr.high, aggregates));
        return typed(BOOLEAN);
      }
      case "isNull":
        this.#typedLeft(this.#operand(scope, expr.left, aggregates), "IS NULL");
        return typed(BOOLEAN);
    }
  }

  #binary(
    scope: Source[],
    expr: Extract<SqlExpression, { kind: "binary" }>,
    aggregates: boolean,
    typed: (schema: Schema) => Operand,
  ): Operand {
    const left = this.#operand(scope, expr.left, aggregates);
    const right = this.#operand(scope, expr.right, aggregates);
    if (ARITHMETIC.has(expr.op)) {
      const divisor = this.#checkDivisor(expr.op, expr.right);
      const types = this.#arithmetic(left, right);
      if (!types || !divisor) return { kind: "broken" };
      const type = ARITHMETIC_RESULT_TYPES.find((t) => types.includes(t)) ?? "integer";
      return typed(schemaOf(type));
    }
    if (COMPARISON_OPERATORS.has(expr.op)) {
      this.#compare(left, right);
      return typed(BOOLEAN);
    }
    if (PATTERNS.has(expr.op)) {
      if (left.kind === "untyped") {
        this.report(`${expr.op} needs a String or Enum value on its left`, expr.left.span);
      } else if (left.kind === "typed" && !isTextual(left.schema.config)) {
        this.report(
          `${expr.op} needs a String or Enum value on its left, and ${this.#text(expr.left.span)} is ${typeOf(left.schema.config)}`,
          expr.left.span,
        );
      }
      if (right.kind === "typed" && !isTextual(right.schema.config)) {
        this.report(
          `${expr.op} needs a String or Enum pattern, and ${this.#text(expr.right.span)} is ${typeOf(right.schema.config)}`,
          expr.right.span,
        );
      } else if (right.kind === "untyped") {
        this.#resolve(right, STRING);
      }
      const pattern = expr.right;
      if (REGEX_OPERATORS.has(expr.op) && pattern.kind === "literal" && pattern.type === "string") {
        const problem = regexProblem(pattern.value);
        if (problem) this.report(`The pattern ${problem}`, pattern.span);
      }
      return typed(BOOLEAN);
    }
    for (const operand of [left, right]) {
      if (operand.kind === "typed" && !sameType(operand.schema.config, BOOLEAN.config)) {
        this.report(
          `${expr.op} needs conditions, and ${this.#text(operand.node.span)} is ${typeOf(operand.schema.config)}`,
          operand.node.span,
        );
      } else {
        this.#resolve(operand, BOOLEAN);
      }
    }
    return typed(BOOLEAN);
  }

  // The field types of both operands of arithmetic, typing an untyped one from the other.
  #arithmetic(left: Operand, right: Operand): string[] | undefined {
    if (left.kind === "broken" || right.kind === "broken") return undefined;
    if (left.kind === "untyped" && right.kind === "untyped") {
      this.report(
        "Arithmetic needs a column or a number on one side to know its type",
        left.node.span,
      );
      return undefined;
    }
    const valid = [left, right].every(
      (operand) =>
        operand.kind !== "typed" ||
        this.arithmeticOperand(
          operand.schema.config,
          this.#text(operand.node.span),
          operand.node.span,
        ),
    );
    if (!valid) return undefined;
    if (left.kind === "untyped" && right.kind === "typed") this.#resolve(left, right.schema);
    if (right.kind === "untyped" && left.kind === "typed") this.#resolve(right, left.schema);
    return [left, right].flatMap((operand) =>
      operand.kind === "typed" ? [operand.schema.config.type] : [],
    );
  }

  #typedLeft(left: Operand, operator: string): Operand {
    if (left.kind !== "untyped") return left;
    this.report(`The left side of ${operator} needs a column or a typed value`, left.node.span);
    return { kind: "broken" };
  }

  // Check two compared operands: numbers compare with numbers, other types with the same type,
  // and a placeholder, string or NULL takes the other side's type.
  #compare(left: Operand, right: Operand): void {
    if (left.kind === "broken" || right.kind === "broken") return;
    if (left.kind === "typed" && right.kind === "untyped") {
      this.#resolve(right, left.schema);
    } else if (left.kind === "untyped" && right.kind === "typed") {
      this.#resolve(left, right.schema);
    } else if (left.kind === "typed" && right.kind === "typed") {
      const l = left.schema.config;
      const r = right.schema.config;
      const numeric =
        Boolean(l.array) === Boolean(r.array) &&
        NUMERIC_TYPES.includes(l.type) &&
        NUMERIC_TYPES.includes(r.type);
      if (!numeric && !sameType(l, r)) {
        this.report(
          `Cannot compare ${this.#text(left.node.span)} (${typeOf(l)}) with ${this.#text(right.node.span)} (${typeOf(r)})`,
          right.node.span,
        );
      }
    } else if (left.kind === "untyped" && right.kind === "untyped") {
      this.report(
        "One side of the comparison needs a column or a typed value to know its type",
        left.node.span,
      );
    }
  }

  // Give an untyped operand the type `target`, or check a typed one has it.
  #resolve(operand: Operand, target: Schema): void {
    if (operand.kind === "broken") return;
    if (operand.kind === "typed") {
      if (!sameType(operand.schema.config, target.config)) {
        const expected =
          target === BOOLEAN
            ? "a condition"
            : (TYPE_LABELS[target.config.type] ?? target.config.type);
        this.report(
          `Expected ${expected}, but ${this.#text(operand.node.span)} is ${typeOf(operand.schema.config)}`,
          operand.node.span,
        );
      }
      return;
    }
    const { node } = operand;
    if (node.kind === "param") {
      this.typeParam(node, target);
    } else if (node.type === "string" && target.config.type !== "string") {
      this.#checkText(target, node);
    }
  }

  #checkText(target: Schema, literal: SqlLiteral): void {
    const { config, name } = target;
    if (config.type === "enum" && !config.array) {
      const values = (config.allowedValues ?? []).map((v) => v.value);
      if (!values.includes(literal.value)) {
        this.report(
          `'${literal.value}' is not a value of ${quoteName(name)}: ${values.join(", ")}`,
          literal.span,
        );
      }
      return;
    }
    const problem = textProblem(config, literal.value);
    if (!problem) return;
    const owner = name === "?column?" ? "" : ` for ${quoteName(name)}`;
    this.report(`'${literal.value}'${owner} ${problem}`, literal.span);
  }

  // Check a value TailorDB reads as `schema`: a written value, LIMIT, OFFSET, or a vector query.
  value(value: SqlValue, schema: Schema): void {
    const { config, name } = schema;
    switch (value.kind) {
      case "param":
        this.typeParam(value, schema);
        return;
      case "array": {
        if (!config.array) {
          this.report(`${quoteName(name)} is not an array field`, value.span);
          return;
        }
        const element = { config: { ...config, array: false, required: true }, name };
        for (const item of value.items) {
          if (item.kind === "param") {
            this.report("Array elements cannot be placeholders", item.span);
          } else if (item.kind === "literal" && item.type === "null") {
            this.report("Array elements cannot be NULL", item.span);
          } else {
            this.value(item, element);
          }
        }
        return;
      }
      case "literal":
        break;
    }
    if (value.type === "null") {
      if (config.required) {
        this.report(`${quoteName(name)} is required, so it cannot be NULL`, value.span);
      }
      return;
    }
    if (value.type === "string") {
      this.#checkText(schema, value);
      return;
    }
    const valid =
      value.type === "boolean"
        ? config.type === "boolean" && !config.array
        : !config.array &&
          (config.type === "integer"
            ? isInt32(value.value)
            : config.type === "float" || config.type === "decimal"
              ? NUMBER_TEXT.test(value.value)
              : false);
    if (!valid) {
      this.report(
        `${value.value} is not a valid ${TYPE_LABELS[config.type] ?? config.type}${config.array ? " array" : ""} value for ${quoteName(name)}`,
        value.span,
      );
    }
  }

  // The result columns of a select list or RETURNING clause.
  columns(scope: Source[], items: SqlSelectItem[]): SqlTypedName[] {
    const columns: SqlTypedName[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const { expr } = item;
      const duplicates: string[] = [];
      const add = (name: string, value: Selected | undefined) => {
        if (seen.has(name)) {
          duplicates.push(name);
          return;
        }
        seen.add(name);
        if (!value) return;
        const selected = this.type(value.schema.config, "select");
        columns.push({ name, type: value.nullable ? nullable(selected) : selected });
      };
      if (expr.kind === "star") {
        for (const source of this.#starSources(scope, expr.table)) {
          for (const [name, config] of source.table.fields) {
            add(name, {
              schema: { config, name },
              nullable: this.#nullable(source, name, config),
            });
          }
        }
      } else {
        add(item.alias?.name ?? defaultName(expr), this.#scalar(scope, expr, "the select list"));
      }
      if (duplicates.length > 0) {
        const [only] = duplicates;
        this.report(
          duplicates.length === 1 && only
            ? `Column ${quoteName(only)} appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS`
            : `Columns ${listOf(duplicates.map(quoteName), "and")} appear more than once in the result, and TailorDB keeps only the last of each; give the columns distinct names with AS`,
          item.span,
        );
      }
    }
    return columns;
  }

  #starSources(scope: Source[], table: SqlIdentifier | undefined): Source[] {
    if (!table) return scope;
    const sources = scope.filter((source) => source.name === table.name);
    if (sources.length === 0) this.#missingSource(scope, table);
    return sources;
  }

  // The result columns of RETURNING, which can only return columns.
  returning(scope: Source[], items: SqlSelectItem[]): SqlTypedName[] {
    const columns = items.filter((item) => {
      if (item.expr.kind === "column" || item.expr.kind === "star") return true;
      this.report("RETURNING takes only columns and * in TailorDB SQL", item.span);
      return false;
    });
    return this.columns(scope, columns);
  }

  // Check that the select list, ORDER BY and HAVING read only GROUP BY keys outside aggregates.
  #checkGrouping(
    scope: Source[],
    keys: readonly SqlColumnRef[],
    refs: readonly SqlColumnRef[],
  ): void {
    const fieldOf = (ref: SqlColumnRef) => {
      const found = this.#lookup(scope, ref).found;
      return found && `${found.source.name}\u0000${ref.column.name}`;
    };
    const grouped = new Set(keys.map(fieldOf));
    const reported = new Set<number>();
    for (const ref of refs) {
      const field = fieldOf(ref);
      if (field && !grouped.has(field) && !reported.has(ref.span.start)) {
        reported.add(ref.span.start);
        this.report(
          `Column ${quoteName(ref.column.name)} must appear in GROUP BY or be used in an aggregate`,
          ref.span,
        );
      }
    }
  }

  #uniqueKeys(table: Table): string[][] {
    return [
      ...[...table.fields]
        .filter(([, config]) => config.unique && !config.array)
        .map(([field]) => [field]),
      ...Object.values(table.definition.indexes ?? {})
        .filter((index) => index.unique)
        .map((index) => index.fields),
    ];
  }

  // Whether every source is pinned to at most one row: by a unique key whose columns AND-ed
  // equalities match to fixed values, or to columns of sources already pinned.
  atMostOneRow(
    scope: Source[],
    where: SqlExpression | undefined,
    joins: readonly JoinedSource[],
  ): boolean {
    // The ON of an outer join cannot pin its preserved side; a LEFT JOIN's can pin the joined
    // table, and every side once WHERE proves the joined table has a row.
    const equalitiesOf = (condition: SqlExpression | undefined, only: Source | undefined) =>
      this.#conjuncts(condition).flatMap((conjunct) =>
        conjunct.kind === "binary" && conjunct.op === "=" ? [{ condition: conjunct, only }] : [],
      );
    const equalities = [
      ...equalitiesOf(where, undefined),
      ...joins
        .filter((join) => join.type !== "right" && join.type !== "full")
        .flatMap((join) =>
          equalitiesOf(
            join.on,
            join.type === "left" && join.source.nullable ? join.source : undefined,
          ),
        ),
    ];
    const sourceOf = (operand: SqlExpression) =>
      operand.kind === "column" ? this.#lookup(scope, operand).found?.source : undefined;
    const pinned = new Set<Source>();
    for (let changed = true; changed;) {
      changed = false;
      for (const source of scope) {
        if (pinned.has(source)) continue;
        const columns = new Set<string>();
        for (const { condition, only } of equalities) {
          if (only && only !== source) continue;
          for (const [side, other] of [
            [condition.left, condition.right],
            [condition.right, condition.left],
          ] as const) {
            if (side.kind !== "column" || sourceOf(side) !== source) continue;
            const otherSource = sourceOf(other);
            if (isFixed(other) || (otherSource && pinned.has(otherSource))) {
              columns.add(side.column.name);
            }
          }
        }
        if (
          this.#uniqueKeys(source.table).some((key) => key.every((field) => columns.has(field)))
        ) {
          pinned.add(source);
          changed = true;
        }
      }
    }
    return pinned.size === scope.length;
  }

  // Check a value assigned to `target` by UPDATE or ON CONFLICT DO UPDATE.
  #assigned(scope: Source[], target: Schema, value: SqlSetOperand): void {
    if (value.kind !== "column") {
      this.value(value, target);
      return;
    }
    const column = this.column(scope, value);
    if (column && column.schema.config.type !== target.config.type) {
      this.report(
        `Cannot set ${quoteName(target.name)} (${typeOf(target.config)}) from ${quoteName(column.schema.name)} (${typeOf(column.schema.config)})`,
        value.span,
      );
    }
  }

  #notId(column: SqlIdentifier): boolean {
    if (column.name !== "id") return true;
    this.report(`${quoteName("id")} cannot be updated`, column.span);
    return false;
  }

  statement(statement: SqlStatement): { columns: SqlTypedName[]; cardinality: SqlCardinality } {
    switch (statement.kind) {
      case "select":
        return this.#select(statement);
      case "insert": {
        const table = this.table(statement.table);
        if (!table) return { columns: [], cardinality: "many" };
        const scope: Source[] = [{ table, name: table.definition.name, nullable: false }];
        const listed = new Set<string>();
        for (const column of statement.columns) {
          if (listed.has(column.name)) {
            this.report(`Column ${quoteName(column.name)} is listed more than once`, column.span);
          }
          listed.add(column.name);
          this.fieldOf(table, column);
        }
        if (statement.rows !== "default") {
          for (const row of statement.rows) {
            if (row.values.length !== statement.columns.length) {
              const values = row.values.length;
              const columns = statement.columns.length;
              this.report(
                `VALUES has ${values} value${values === 1 ? "" : "s"} for ${columns} column${columns === 1 ? "" : "s"}`,
                row.span,
              );
              continue;
            }
            row.values.forEach((value, index) => {
              const column = statement.columns[index];
              const config = column && table.fields.get(column.name);
              if (column && config && value.kind !== "default") {
                this.value(value, { config, name: column.name });
              }
            });
          }
        }
        const conflict = statement.onConflict;
        if (conflict) {
          const config = this.fieldOf(table, conflict.column);
          if (config && !config.unique) {
            this.report(
              `ON CONFLICT takes "id" or a unique field, and ${quoteName(conflict.column.name)} is not unique`,
              conflict.column.span,
            );
          }
          if (conflict.action.kind === "update") {
            for (const set of conflict.action.sets) {
              const target = this.fieldOf(table, set.column);
              if (!target || !this.#notId(set.column)) continue;
              const schema = { config: target, name: set.column.name };
              if (set.value.kind !== "excluded") {
                this.value(set.value, schema);
                continue;
              }
              const source = this.fieldOf(table, set.value.column);
              if (source && !sameType(source, target)) {
                this.report(
                  `Cannot set ${quoteName(set.column.name)} (${typeOf(target)}) from EXCLUDED.${quoteName(set.value.column.name)} (${typeOf(source)})`,
                  set.value.span,
                );
              }
            }
          }
        }
        if (!statement.returning) return { columns: [], cardinality: "none" };
        const columns = this.returning(scope, statement.returning);
        const single = statement.rows === "default" || statement.rows.length === 1;
        const skippable = conflict?.action.kind === "nothing";
        return { columns, cardinality: single ? (skippable ? "maybeOne" : "one") : "many" };
      }
      case "update":
      case "delete": {
        const table = this.table(statement.table);
        if (!table) return { columns: [], cardinality: "many" };
        const scope: Source[] = [{ table, name: table.definition.name, nullable: false }];
        if (statement.kind === "update") {
          for (const set of statement.sets) {
            const config = this.fieldOf(table, set.column);
            if (!config || !this.#notId(set.column)) continue;
            const target = { config, name: set.column.name };
            if (set.value.kind !== "arithmetic") {
              this.#assigned(scope, target, set.value);
              continue;
            }
            if (
              !this.arithmeticOperand(config, quoteName(set.column.name), set.value.span) ||
              !this.#checkDivisor(set.value.op, set.value.right)
            ) {
              continue;
            }
            this.#assigned(scope, target, set.value.left);
            this.#assigned(scope, target, set.value.right);
          }
        }
        this.condition(scope, statement.where, false);
        if (!statement.returning) return { columns: [], cardinality: "none" };
        if (statement.kind === "delete") {
          this.narrow(scope, statement.where);
        } else if (!table.definition.typeHookExpr?.update) {
          // An update hook runs after WHERE and may change the fields it sets.
          const hooked = [...table.fields]
            .filter(([, config]) => config.hooks?.update)
            .map(([name]) => name);
          this.narrow(
            scope,
            statement.where,
            new Set([...statement.sets.map((set) => set.column.name), ...hooked]),
          );
        }
        const columns = this.returning(scope, statement.returning);
        return {
          columns,
          cardinality: this.atMostOneRow(scope, statement.where, []) ? "maybeOne" : "many",
        };
      }
    }
  }

  #select(statement: Extract<SqlStatement, { kind: "select" }>): {
    columns: SqlTypedName[];
    cardinality: SqlCardinality;
  } {
    const scope: Source[] = [];
    const joined: JoinedSource[] = [];
    this.bind(scope, statement.from);
    statement.joins.forEach((join, index) => {
      this.#later = new Set(
        statement.joins
          .slice(index + 1)
          .map((later) => (later.table.alias ?? later.table.table).name),
      );
      const source = this.bind(scope, join.table);
      if (source) {
        if (join.type === "left" || join.type === "full") source.nullable = true;
        if (join.type === "right" || join.type === "full") {
          for (const preceding of scope.slice(0, -1)) preceding.nullable = true;
        }
        joined.push({ type: join.type, on: join.on, source });
      }
      this.condition(scope, join.on, false);
    });
    this.#later = new Set();
    const aggregated = statement.items.some((item) => item.expr.kind === "aggregate");
    this.#grouped = statement.groupBy.length > 0;
    const grouping = this.#grouped || aggregated || statement.having !== undefined;
    this.condition(scope, statement.where, false);
    for (const column of statement.groupBy) this.#queryable(scope, column);
    this.condition(scope, statement.having, true);
    this.narrow(scope, statement.where);
    const columns = this.columns(scope, statement.items);
    const outputs = statement.items.flatMap((item): { name: string; config?: SqlFieldConfig }[] => {
      const { expr } = item;
      if (expr.kind === "star") {
        return this.#starSources(scope, expr.table).flatMap((source) =>
          [...source.table.fields].map(([name, config]) => ({ name, config })),
        );
      }
      const config = expr.kind === "column" ? this.#lookup(scope, expr).found?.config : undefined;
      return [{ name: item.alias?.name ?? defaultName(expr), config }];
    });
    const ordered: SqlColumnRef[] = [];
    for (const item of statement.orderBy) {
      if (item.by.kind === "column") {
        const name = item.by.column.name;
        const matches = item.by.table ? [] : outputs.filter((output) => output.name === name);
        const [match] = matches;
        if (matches.length > 1) {
          this.report(
            `ORDER BY ${quoteName(name)} matches more than one result column`,
            item.by.span,
          );
        } else if (match) {
          if (match.config) this.#checkQueryable(match.config, name, item.by.span);
        } else {
          this.#queryable(scope, item.by);
          ordered.push(item.by);
        }
        continue;
      }
      const column = this.#queryable(scope, item.by.column);
      if (column && (column.schema.config.type !== "string" || !column.schema.config.vector)) {
        this.report(
          `vector_similarity takes a vector field, and ${quoteName(item.by.column.column.name)} is not one`,
          item.by.column.span,
        );
      }
      if (grouping) {
        this.report("vector_similarity cannot be used with GROUP BY or aggregates", item.by.span);
      }
      if (column) this.value(item.by.value, column.schema);
    }
    if (grouping) {
      const selected = statement.items.flatMap((item): SqlColumnRef[] => {
        const { expr } = item;
        if (expr.kind === "aggregate") return [];
        if (expr.kind !== "star") return columnsOf(expr);
        return this.#starSources(scope, expr.table).flatMap((source) =>
          [...source.table.fields.keys()].map((name): SqlColumnRef => ({
            kind: "column",
            table: { name: source.name, quoted: true, span: expr.span },
            column: { name, quoted: true, span: expr.span },
            span: expr.span,
          })),
        );
      });
      const having = statement.having ? columnsOf(statement.having) : [];
      this.#checkGrouping(scope, statement.groupBy, [...selected, ...ordered, ...having]);
    }
    for (const [name, count] of [
      ["LIMIT", statement.limit],
      ["OFFSET", statement.offset],
    ] as const) {
      if (!count) continue;
      if (count.kind === "literal" && count.type === "null") {
        this.report("LIMIT and OFFSET take a number, not NULL", count.span);
        continue;
      }
      this.value(count, { config: { type: "integer", required: true }, name });
      if (count.kind === "literal" && count.value.startsWith("-")) {
        this.report("LIMIT and OFFSET take a number that is not negative", count.span);
      }
    }
    for (const lock of statement.locks) {
      const reason = aggregated
        ? "aggregates"
        : joined.some((join) => join.type !== "inner" && join.type !== "cross")
          ? "outer joins"
          : statement.groupBy.length > 0 || statement.having
            ? "GROUP BY or HAVING"
            : undefined;
      if (reason) this.report(`FOR UPDATE and FOR SHARE cannot be used with ${reason}`, lock);
    }
    const limit = statement.limit;
    const limitValue =
      limit?.kind === "literal" && INTEGER_LITERAL.test(limit.value)
        ? Number(limit.value)
        : undefined;
    let cardinality: SqlCardinality = "many";
    if (aggregated && statement.groupBy.length === 0) {
      const certain = !statement.having && !statement.offset && (!limit || (limitValue ?? 0) >= 1);
      cardinality = certain ? "one" : "maybeOne";
    } else if (
      this.atMostOneRow(scope, statement.where, joined) ||
      (limitValue !== undefined && limitValue <= 1)
    ) {
      cardinality = "maybeOne";
    }
    return { columns, cardinality };
  }
}

function serializeField(config: SqlFieldConfig): unknown[] {
  return SQL_FIELD_KEYS.map((key) => {
    if (key === "allowedValues") return config.allowedValues?.map((v) => v.value);
    if (key === "hooks") return Boolean(config.hooks?.update);
    if (key === "fields") {
      return config.fields && Object.entries(config.fields).map(([n, f]) => [n, serializeField(f)]);
    }
    return config[key];
  });
}

/**
 * Serialize everything in the definitions that the analysis reads, so the
 * text changes exactly when the analysis of some statement could.
 * @param definitions - TailorDB tables by namespace, and how dates are returned
 * @returns Deterministic JSON text
 */
export function serializeSqlDefinitions(definitions: SqlDefinitions): string {
  return JSON.stringify([
    definitions.temporal,
    [...definitions.namespaces].map(([namespace, tables]) => [
      namespace,
      tables.map((table) => [
        table.name,
        Boolean(table.typeHookExpr?.update),
        Object.entries(table.fields).map(([name, field]) => [name, serializeField(field.config)]),
        Object.values(table.indexes ?? {})
          .filter((index) => index.unique)
          .map((index) => index.fields),
      ]),
    ]),
  ]);
}

/**
 * Check a `.sql` file against TailorDB definitions and derive its parameter
 * and row types.
 * @param source - Contents of the `.sql` file
 * @param definitions - TailorDB tables by namespace, and how dates are returned
 * @returns The analysis, or every problem found
 */
export function analyzeSql(source: string, definitions: SqlDefinitions): SqlAnalysisResult {
  const parsed = parseSql(source);
  if (!parsed.statement) return { diagnostics: parsed.diagnostics };
  const analyzer = new Analyzer(definitions, source);
  const { columns, cardinality } = analyzer.statement(parsed.statement);
  const namespace = analyzer.namespace;
  if (analyzer.diagnostics.length > 0 || namespace === undefined) {
    return { diagnostics: analyzer.diagnostics.toSorted((a, b) => a.start - b.start) };
  }
  return {
    analysis: {
      namespace,
      text: parsed.text,
      paramNames: parsed.paramNames,
      params: analyzer.params(parsed.paramNames),
      columns,
      cardinality,
      usesTemporal: analyzer.usesTemporal,
    },
    diagnostics: [],
  };
}
