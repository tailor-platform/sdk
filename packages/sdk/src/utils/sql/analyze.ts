import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "#/utils/field-column-type";
import {
  parseSql,
  PATTERN_OPERATORS,
  type SqlAggregate,
  type SqlArithmetic,
  type SqlColumnRef,
  type SqlCondition,
  type SqlDefault,
  type SqlDiagnostic,
  type SqlExcluded,
  type SqlExpression,
  type SqlIdentifier,
  type SqlJoin,
  type SqlLiteral,
  type SqlNegation,
  type SqlParam,
  type SqlSelectItem,
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
}

const SQL_FIELD_KEYS = Object.keys({
  type: true,
  required: true,
  array: true,
  unique: true,
  vector: true,
  allowedValues: true,
  fields: true,
} satisfies Record<keyof SqlFieldConfig, true>) as (keyof SqlFieldConfig)[];

/** The parts of a parsed TailorDB table the analysis reads. */
interface SqlTableDefinition {
  name: string;
  fields: Record<string, { config: SqlFieldConfig }>;
  indexes?: Record<string, { fields: string[]; unique?: boolean }>;
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
const ARITHMETIC_TYPES = ["integer", "float", "decimal"];
const COMPARABLE_TYPES = [...ARITHMETIC_TYPES, "string", "enum", "date", "time", "datetime"];
// Arithmetic yields the first of these its operands include.
const ARITHMETIC_RESULT_TYPES = ["float", "decimal", "integer"];
const TYPE_LABELS: Readonly<Record<string, string>> = {
  integer: "Integer",
  float: "Float",
  decimal: "Decimal",
  string: "String",
  enum: "Enum",
  date: "Date",
  time: "Time",
  datetime: "DateTime",
};
const INTEGER_LITERAL = /^-?[0-9]+$/;
const INT32_MAX = 2147483647;

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

/** A joined table, with its join's kind and condition. */
interface JoinedSource {
  type: SqlJoin["type"];
  on?: SqlCondition;
  source: Source;
}

/** The type of the value an expression yields. */
interface ValueType {
  config: SqlFieldConfig;
  nullable: boolean;
}

/** The column a value is compared with or written to. */
interface Target {
  config: SqlFieldConfig;
  name: string;
}

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

function literalType(literal: SqlLiteral): ValueType | undefined {
  if (literal.type === "null") return undefined;
  const type =
    literal.type === "number"
      ? INTEGER_LITERAL.test(literal.value)
        ? "integer"
        : "float"
      : literal.type;
  return { config: { type }, nullable: false };
}

// The columns without whose value an expression's value is null.
function nullPropagatingColumns(expr: SqlExpression): SqlColumnRef[] {
  switch (expr.kind) {
    case "column":
      return [expr];
    case "arithmetic":
      return [...nullPropagatingColumns(expr.left), ...nullPropagatingColumns(expr.right)];
    case "negation":
      return nullPropagatingColumns(expr.operand);
    default:
      return [];
  }
}

// The name TailorDB gives a result column that has no alias, when it is known.
function defaultName(expr: SqlExpression): string | undefined {
  switch (expr.kind) {
    case "column":
      return expr.column.name;
    case "aggregate":
      return expr.fn;
    case "arithmetic":
      return "expression";
    case "literal":
      return "?column?";
    case "negation":
      return expr.operand.kind === "literal" ? undefined : defaultName(expr.operand);
    default:
      return undefined;
  }
}

function describeOperand(operand: SqlColumnRef | SqlLiteral | SqlAggregate): string {
  switch (operand.kind) {
    case "column":
      return quoteName(operand.column.name);
    case "literal":
      return operand.type === "string" ? `'${operand.value}'` : operand.value;
    case "aggregate":
      return operand.fn.toUpperCase();
  }
}

function describeSource(source: Source): string {
  const table = quoteName(source.table.definition.name);
  return source.name === source.table.definition.name ? table : `${table} ${source.name}`;
}

class Analyzer {
  readonly diagnostics: SqlDiagnostic[] = [];
  usesTemporal = false;
  readonly #tables = new Map<string, Table>();
  readonly #params = new Map<string, { type: string }>();
  // The columns of each source a WHERE test proves not null.
  readonly #notNull = new Map<Source, Set<string>>();
  // Whether the SELECT groups its rows, so that every group an aggregate reads has a row.
  #grouped = false;
  #namespace: { name: string; table: string } | undefined;

  constructor(private readonly definitions: SqlDefinitions) {
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
    this.diagnostics.push({ message, start: span.start, length: span.end - span.start });
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
      const type = this.#params.get(name)?.type;
      if (type === undefined) throw new Error(`No type was inferred for placeholder :${name}`);
      return { name, type };
    });
  }

  typeParam(param: SqlParam, type: string): void {
    const existing = this.#params.get(param.name);
    if (!existing) {
      this.#params.set(param.name, { type });
    } else if (existing.type !== type) {
      this.report(
        `Placeholder :${param.name} is used as both ${existing.type} and ${type}; use separate placeholders`,
        param.span,
      );
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

  bind(scope: Source[], ref: SqlTableRef): void {
    const table = this.table(ref.table);
    if (!table) return;
    const name = ref.alias ?? ref.table;
    if (scope.some((source) => source.name === name.name)) {
      this.report(`Table or alias ${quoteName(name.name)} is used more than once`, name.span);
      return;
    }
    scope.push({ table, name: name.name, nullable: false });
  }

  #missingSource(scope: Source[], identifier: SqlIdentifier): void {
    if (scope.length > 0) {
      this.report(
        `Table or alias ${quoteName(identifier.name)} is not in the query`,
        identifier.span,
      );
    }
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

  column(
    scope: Source[],
    ref: SqlColumnRef,
    outputNames?: ReadonlySet<string>,
  ): (ValueType & { source: Source }) | undefined {
    const { candidates, found } = this.#lookup(scope, ref);
    if (found) {
      const { source, config } = found;
      return { source, config, nullable: this.#nullable(source, ref.column.name, config) };
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
    if (outputNames?.has(ref.column.name)) return undefined;
    if (scope.length > 0) {
      this.#missingColumn(
        ref.column,
        scope.map((source) => source.table),
      );
    }
    return undefined;
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

  #conjuncts(condition: SqlCondition | undefined): SqlCondition[] {
    if (!condition) return [];
    if (condition.kind !== "and") return [condition];
    return [...this.#conjuncts(condition.left), ...this.#conjuncts(condition.right)];
  }

  // The columns a condition holds for only when they have a value.
  #requiredColumns(condition: SqlCondition): SqlColumnRef[] {
    switch (condition.kind) {
      case "isNull":
        return condition.not ? nullPropagatingColumns(condition.left) : [];
      case "compare":
        return [
          ...nullPropagatingColumns(condition.left),
          ...nullPropagatingColumns(condition.right),
        ];
      case "in":
      case "between":
        return nullPropagatingColumns(condition.left);
      case "and":
      case "or":
        return [];
    }
  }

  // Record the columns the AND-ed conditions of `where` need a value in, except for the columns an UPDATE sets.
  narrow(scope: Source[], where: SqlCondition | undefined, assigned?: ReadonlySet<string>): void {
    for (const ref of this.#conjuncts(where).flatMap((condition) =>
      this.#requiredColumns(condition),
    )) {
      const { found } = this.#lookup(scope, ref);
      if (!found) continue;
      found.source.nullable = false;
      if (assigned?.has(ref.column.name)) continue;
      const columns = this.#notNull.get(found.source) ?? new Set<string>();
      this.#notNull.set(found.source, columns.add(ref.column.name));
    }
  }

  // The aggregate's result type, or undefined when its argument cannot be aggregated.
  aggregate(scope: Source[], aggregate: SqlAggregate): ValueType | undefined {
    const arg = aggregate.arg && this.expression(scope, aggregate.arg);
    if (aggregate.fn === "count") return { config: { type: "integer" }, nullable: false };
    if (!arg) return undefined;
    const name = aggregate.fn.toUpperCase();
    const allowed =
      aggregate.fn === "sum" || aggregate.fn === "avg" ? ARITHMETIC_TYPES : COMPARABLE_TYPES;
    if (arg.config.array || !allowed.includes(arg.config.type)) {
      this.report(
        `${name} takes ${fieldOfTypes(allowed)}, not ${typeOf(arg.config)}`,
        aggregate.span,
      );
      return undefined;
    }
    const nullable = !this.#grouped || arg.nullable;
    if (aggregate.fn === "min" || aggregate.fn === "max") return { config: arg.config, nullable };
    const type =
      arg.config.type === "decimal"
        ? "decimal"
        : aggregate.fn === "sum" && arg.config.type === "integer"
          ? "integer"
          : "float";
    return { config: { type }, nullable };
  }

  // The type of an expression's value, after typing the placeholders in it; undefined for a lone
  // placeholder, a NULL, or an expression with a problem.
  expression(scope: Source[], expr: SqlExpression): ValueType | undefined {
    switch (expr.kind) {
      case "column":
        return this.column(scope, expr);
      case "param":
        return undefined;
      case "literal":
        this.#checkInteger(expr);
        return literalType(expr);
      case "aggregate":
        return this.aggregate(scope, expr);
      case "arithmetic":
      case "negation":
        return this.#arithmetic(scope, expr);
    }
  }

  // Arithmetic is null when any operand is, and its placeholders take its operands' write type.
  #arithmetic(scope: Source[], expr: SqlArithmetic | SqlNegation): ValueType | undefined {
    const params: SqlParam[] = [];
    const types = new Set<string>();
    let nullable = false;
    // Whether the operand can take part in arithmetic.
    const visit = (operand: SqlExpression): boolean => {
      if (operand.kind === "arithmetic") {
        const valid = [visit(operand.left), visit(operand.right)].every(Boolean);
        const divisor = operand.right;
        if (operand.op === "/" && divisor.kind === "literal" && Number(divisor.value) === 0) {
          this.report("Dividing by zero fails in TailorDB SQL", divisor.span);
          return false;
        }
        return valid;
      }
      if (operand.kind === "negation") return visit(operand.operand);
      if (operand.kind === "param") {
        params.push(operand);
        return true;
      }
      const type = this.expression(scope, operand);
      if (!type || !this.arithmeticOperand(type.config, describeOperand(operand), operand.span)) {
        return false;
      }
      types.add(type.config.type);
      nullable ||= type.nullable;
      return true;
    };
    const valid = visit(expr);
    const type = ARITHMETIC_RESULT_TYPES.find((candidate) => types.has(candidate)) ?? "integer";
    for (const param of params) this.typeParam(param, this.type({ type }, "write"));
    return valid ? { config: { type }, nullable } : undefined;
  }

  #checkInteger(literal: SqlLiteral): void {
    if (literal.type !== "number" || !INTEGER_LITERAL.test(literal.value)) return;
    if (Math.abs(Number(literal.value)) <= INT32_MAX) return;
    this.report(
      `TailorDB SQL takes integers in the 32-bit range, and ${literal.value} is not`,
      literal.span,
    );
  }

  arithmeticOperand(config: SqlFieldConfig, name: string, span: SqlSpan): boolean {
    if (!config.array && ARITHMETIC_TYPES.includes(config.type)) return true;
    this.report(
      `Arithmetic needs ${fieldOfTypes(ARITHMETIC_TYPES)}, and ${name} is ${typeOf(config)}`,
      span,
    );
    return false;
  }

  checkLiteral(target: Target, literal: SqlLiteral): void {
    if (target.config.type !== "enum" || literal.type !== "string") return;
    const values = (target.config.allowedValues ?? []).map((v) => v.value);
    if (!values.includes(literal.value)) {
      this.report(
        `'${literal.value}' is not a value of ${quoteName(target.name)}: ${values.join(", ")}`,
        literal.span,
      );
    }
  }

  checkValue(
    scope: Source[],
    value: SqlExpression,
    paramType: string | undefined,
    target?: Target,
  ): void {
    if (value.kind === "param") {
      if (paramType !== undefined) this.typeParam(value, paramType);
    } else if (value.kind === "literal") {
      if (target) this.checkLiteral(target, value);
    } else {
      this.expression(scope, value);
    }
  }

  condition(scope: Source[], condition: SqlCondition | undefined): void {
    if (!condition) return;
    switch (condition.kind) {
      case "and":
      case "or":
        this.condition(scope, condition.left);
        this.condition(scope, condition.right);
        return;
      case "isNull":
        this.#operand(scope, condition.left, false);
        return;
      case "compare": {
        const left = this.#operand(scope, condition.left, true);
        const paramType = PATTERN_OPERATORS.has(condition.op) ? "string" : left?.paramType;
        this.#compared(scope, condition.right, paramType, left?.target);
        return;
      }
      case "in": {
        const left = this.#operand(scope, condition.left, true);
        for (const item of condition.items)
          this.#compared(scope, item, left?.paramType, left?.target);
        return;
      }
      case "between": {
        const left = this.#operand(scope, condition.left, true);
        this.#compared(scope, condition.low, left?.paramType, left?.target);
        this.#compared(scope, condition.high, left?.paramType, left?.target);
        return;
      }
    }
  }

  // Check a value a condition compares with its left side.
  #compared(
    scope: Source[],
    value: SqlExpression,
    paramType: string | undefined,
    target: Target | undefined,
  ): void {
    if (value.kind === "literal") this.#checkInteger(value);
    this.checkValue(scope, value, paramType, target);
  }

  #operand(
    scope: Source[],
    operand: SqlExpression,
    compared: boolean,
  ): { paramType: string; target?: Target } | undefined {
    if (operand.kind !== "column") {
      const type = this.expression(scope, operand);
      return type && { paramType: this.type(type.config, "write") };
    }
    const column = this.column(scope, operand);
    if (!column) return undefined;
    if (compared && (column.config.array || column.config.type === "nested")) {
      this.report(
        `Comparing the ${column.config.array ? "array" : "nested"} field ${quoteName(operand.column.name)} is not supported by TailorDB SQL`,
        operand.span,
      );
      return undefined;
    }
    return {
      paramType: this.type(column.config, "write"),
      target: { config: column.config, name: operand.column.name },
    };
  }

  // The result columns of a select list or RETURNING clause.
  columns(scope: Source[], items: SqlSelectItem[]): SqlTypedName[] {
    const columns: SqlTypedName[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const { expr } = item;
      const duplicates: string[] = [];
      const add = (name: string, type: ValueType | undefined) => {
        if (seen.has(name)) {
          duplicates.push(name);
          return;
        }
        seen.add(name);
        if (!type) return;
        const selected = this.type(type.config, "select");
        columns.push({ name, type: type.nullable ? nullable(selected) : selected });
      };
      if (expr.kind === "star") {
        const tableName = expr.table?.name;
        const sources =
          tableName === undefined ? scope : scope.filter((source) => source.name === tableName);
        if (expr.table && sources.length === 0) this.#missingSource(scope, expr.table);
        for (const source of sources) {
          for (const [name, config] of source.table.fields) {
            add(name, { config, nullable: this.#nullable(source, name, config) });
          }
        }
      } else {
        const name = item.alias?.name ?? defaultName(expr);
        const type = this.expression(scope, expr);
        if (name === undefined) this.report("Name this column with AS", item.span);
        else add(name, type);
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

  // The result columns of RETURNING, which can only return columns.
  returning(scope: Source[], items: SqlSelectItem[]): SqlTypedName[] {
    const columns = items.filter((item) => {
      if (item.expr.kind === "column" || item.expr.kind === "star") return true;
      this.report("RETURNING takes only columns and * in TailorDB SQL", item.span);
      return false;
    });
    return this.columns(scope, columns);
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
  // equalities match to values, or to columns of sources already pinned.
  atMostOneRow(
    scope: Source[],
    where: SqlCondition | undefined,
    joins: readonly JoinedSource[],
  ): boolean {
    // The ON of an outer join cannot pin its preserved side; a LEFT JOIN's can pin the joined
    // table, and every side once WHERE proves the joined table has a row.
    const equalitiesOf = (condition: SqlCondition | undefined, only: Source | undefined) =>
      this.#conjuncts(condition).flatMap((conjunct) =>
        conjunct.kind === "compare" && conjunct.op === "=" ? [{ condition: conjunct, only }] : [],
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
            const fixed =
              other.kind === "param" ||
              other.kind === "literal" ||
              (otherSource && pinned.has(otherSource));
            if (fixed) columns.add(side.column.name);
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

  // Check a value written to `target`, a column of the only table in `scope`.
  checkWritten(scope: Source[], target: Target, value: SqlValue | SqlDefault | SqlExcluded): void {
    const [source] = scope;
    if (value.kind === "default") return;
    if (value.kind === "excluded") {
      if (source) this.fieldOf(source.table, value.column);
      return;
    }
    const type = this.type(target.config, "write");
    this.checkValue(scope, value, target.config.required === true ? type : nullable(type), target);
  }

  statement(statement: SqlStatement): { columns: SqlTypedName[]; cardinality: SqlCardinality } {
    switch (statement.kind) {
      case "select": {
        const scope: Source[] = [];
        const joined: JoinedSource[] = [];
        this.bind(scope, statement.from);
        for (const join of statement.joins) {
          this.bind(scope, join.table);
          const source = scope.at(-1);
          if (source && source.name === (join.table.alias?.name ?? join.table.table.name)) {
            if (join.type === "left" || join.type === "full") source.nullable = true;
            if (join.type === "right" || join.type === "full") {
              for (const preceding of scope.slice(0, -1)) preceding.nullable = true;
            }
            joined.push({ type: join.type, on: join.on, source });
          }
        }
        this.#grouped = statement.groupBy.length > 0;
        for (const join of statement.joins) this.condition(scope, join.on);
        this.narrow(scope, statement.where);
        const columns = this.columns(scope, statement.items);
        const outputNames = new Set(columns.map((column) => column.name));
        this.condition(scope, statement.where);
        for (const column of statement.groupBy) this.column(scope, column);
        this.condition(scope, statement.having);
        for (const item of statement.orderBy) {
          if (item.by.kind === "column") {
            this.column(scope, item.by, outputNames);
            continue;
          }
          const column = this.column(scope, item.by.column);
          if (column && (column.config.type !== "string" || !column.config.vector)) {
            this.report(
              `vector_similarity takes a vector field, and ${quoteName(item.by.column.column.name)} is not one`,
              item.by.column.span,
            );
          }
          if (item.by.value.kind === "param") this.typeParam(item.by.value, "string");
        }
        for (const count of [statement.limit, statement.offset]) {
          if (count?.kind === "param") this.typeParam(count, "number");
        }
        const aggregated = statement.items.some((item) => item.expr.kind === "aggregate");
        let cardinality: SqlCardinality = "many";
        if (aggregated && statement.groupBy.length === 0) {
          cardinality = statement.having || statement.offset ? "maybeOne" : "one";
        } else if (
          this.atMostOneRow(scope, statement.where, joined) ||
          (statement.limit?.kind === "literal" && Number(statement.limit.value) <= 1)
        ) {
          cardinality = "maybeOne";
        }
        return { columns, cardinality };
      }
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
              if (column && config) this.checkWritten(scope, { config, name: column.name }, value);
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
              if (target)
                this.checkWritten(scope, { config: target, name: set.column.name }, set.value);
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
            if (!config) continue;
            if (set.value.kind !== "arithmetic") {
              this.checkWritten(scope, { config, name: set.column.name }, set.value);
              continue;
            }
            if (!this.arithmeticOperand(config, quoteName(set.column.name), set.value.span)) {
              continue;
            }
            const operandType = this.type(config, "write");
            this.checkValue(scope, set.value.left, operandType);
            this.checkValue(scope, set.value.right, operandType);
          }
        }
        this.condition(scope, statement.where);
        if (!statement.returning) return { columns: [], cardinality: "none" };
        const assigned =
          statement.kind === "update"
            ? new Set(statement.sets.map((set) => set.column.name))
            : undefined;
        this.narrow(scope, statement.where, assigned);
        const columns = this.returning(scope, statement.returning);
        return {
          columns,
          cardinality: this.atMostOneRow(scope, statement.where, []) ? "maybeOne" : "many",
        };
      }
    }
  }
}

function serializeField(config: SqlFieldConfig): unknown[] {
  return SQL_FIELD_KEYS.map((key) => {
    if (key === "allowedValues") return config.allowedValues?.map((v) => v.value);
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
  const analyzer = new Analyzer(definitions);
  const { columns, cardinality } = analyzer.statement(parsed.statement);
  const namespace = analyzer.namespace;
  if (analyzer.diagnostics.length > 0 || namespace === undefined) {
    return { diagnostics: analyzer.diagnostics };
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
