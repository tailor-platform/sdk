import { assertDefined } from "#/utils/assert";
import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "#/utils/field-column-type";
import {
  ARITHMETIC_OPERATORS,
  parseSql,
  type SqlColumnRef,
  type SqlDiagnostic,
  type SqlExpression,
  type SqlIdentifier,
  type SqlJoin,
  type SqlSelectItem,
  type SqlSpan,
  type SqlStatement,
  type SqlTableRef,
} from "./parser";
import { isRequired, platformSchemaOf, type PlatformSchemaFieldConfig } from "./platform-schema";
import {
  analyzeWithPlatform,
  type PlatformAnalyzeResult,
  type PlatformField,
} from "./platform-sql";
import type { SqlCardinality } from "#/runtime/sql";

/** The parts of a TailorDB field definition the analysis reads. */
interface SqlFieldConfig extends PlatformSchemaFieldConfig {
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

type PlatformAnalysis = Extract<PlatformAnalyzeResult, { ok: true }>;

const ID_FIELD: SqlFieldConfig = { type: "uuid", required: true, unique: true };
const NUMERIC_TYPES = ["integer", "float", "decimal"];
const ARITHMETIC = new Set(ARITHMETIC_OPERATORS);
const INTEGER_LITERAL = /^[+-]?[0-9]+$/;
const DIVISION_BY_ZERO = "Dividing by zero fails in TailorDB SQL";

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
  on?: SqlExpression;
  source: Source;
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

function typeOf(config: SqlFieldConfig): string {
  return `${config.type}${config.array ? "[]" : ""}`;
}

function isNumeric(config: SqlFieldConfig): boolean {
  return !config.array && NUMERIC_TYPES.includes(config.type);
}

// The definition of a field TailorDB's analyzer typed, as the analysis reads definitions.
function toFieldConfig(field: PlatformField): SqlFieldConfig {
  return {
    type: field.type,
    required: field.required,
    array: field.array,
    allowedValues: field.allowedValues?.map((value) => ({ value })),
    fields: field.fields
      ? Object.fromEntries(
          Object.entries(field.fields).map(([name, child]) => [name, toFieldConfig(child)]),
        )
      : undefined,
  };
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

// Whether an expression is a literal zero, with any signs, which fails as a divisor in TailorDB.
function isZero(expr: SqlExpression): boolean {
  let divisor = expr;
  while (divisor.kind === "unary" && divisor.op !== "NOT") divisor = divisor.operand;
  return divisor.kind === "literal" && divisor.type === "number" && Number(divisor.value) === 0;
}

// The divisors in an expression that are a literal zero.
function zeroDivisors(expr: SqlExpression): SqlExpression[] {
  switch (expr.kind) {
    case "binary":
      return [
        ...(expr.op === "/" && isZero(expr.right) ? [expr.right] : []),
        ...zeroDivisors(expr.left),
        ...zeroDivisors(expr.right),
      ];
    case "unary":
      return zeroDivisors(expr.operand);
    case "in":
      return [expr.left, ...expr.items].flatMap(zeroDivisors);
    case "between":
      return [expr.left, expr.low, expr.high].flatMap(zeroDivisors);
    case "isNull":
      return zeroDivisors(expr.left);
    case "aggregate":
      return expr.arg ? zeroDivisors(expr.arg) : [];
    default:
      return [];
  }
}

// The expressions a statement evaluates on its rows.
function expressionsOf(statement: SqlStatement): SqlExpression[] {
  const items = statement.kind === "select" ? statement.items : (statement.returning ?? []);
  const conditions =
    statement.kind === "select"
      ? [...statement.joins.map((join) => join.on), statement.where, statement.having]
      : statement.kind === "insert"
        ? []
        : [statement.where];
  return [
    ...items.flatMap((item) => (item.expr.kind === "star" ? [] : [item.expr])),
    ...conditions.filter((condition) => condition !== undefined),
  ];
}

/** A problem in a statement, located in its source. */
interface Problem {
  message: string;
  span: SqlSpan;
}

// What fails when the statement runs although TailorDB's analyzer accepts it, as the statement
// alone shows.
function runtimeFailures(statement: SqlStatement): Problem[] {
  const problems = expressionsOf(statement)
    .flatMap(zeroDivisors)
    .map((divisor) => ({ message: DIVISION_BY_ZERO, span: divisor.span }));
  if (statement.kind === "update") {
    for (const { value } of statement.sets) {
      if (value.kind === "arithmetic" && value.op === "/" && isZero(value.right)) {
        problems.push({ message: DIVISION_BY_ZERO, span: value.right.span });
      }
    }
  }
  if (statement.kind === "select") {
    for (const count of [statement.limit, statement.offset]) {
      if (count?.kind === "literal" && count.value.startsWith("-")) {
        problems.push({
          message: "LIMIT and OFFSET take a number that is not negative",
          span: count.span,
        });
      }
    }
    return problems;
  }
  // TailorDB rejects aggregates in RETURNING itself, and fails to return other expressions.
  for (const item of statement.returning ?? []) {
    if (!["column", "star", "aggregate"].includes(item.expr.kind)) {
      problems.push({
        message: "RETURNING takes only columns and * in TailorDB SQL",
        span: item.span,
      });
    }
  }
  return problems;
}

function diagnosticOf({ message, span }: Problem): SqlDiagnostic {
  return { message, start: span.start, length: span.end - span.start };
}

// The tables a statement names, in order.
function tableNames(statement: SqlStatement): SqlIdentifier[] {
  if (statement.kind !== "select") return [statement.table];
  return [statement.from.table, ...statement.joins.map((join) => join.table.table)];
}

function tablesOf(definitions: SqlDefinitions): Map<string, Table> {
  const tables = new Map<string, Table>();
  for (const [namespace, definitionsOfNamespace] of definitions.namespaces) {
    for (const definition of definitionsOfNamespace) {
      const fields = new Map<string, SqlFieldConfig>([["id", ID_FIELD]]);
      for (const [name, field] of Object.entries(definition.fields)) {
        if (name !== "id") fields.set(name, field.config);
      }
      tables.set(definition.name, { definition, namespace, fields });
    }
  }
  return tables;
}

// Derives what TailorDB's analyzer does not: which values can be null, how many rows come back,
// the TypeScript types, and the runtime failures the analyzer accepts.
class Analyzer {
  readonly diagnostics: SqlDiagnostic[] = [];
  usesTemporal = false;
  // The columns of each source a WHERE test proves not null.
  readonly #notNull = new Map<Source, Set<string>>();
  // Whether the SELECT groups its rows, so that every group an aggregate reads has a row.
  #grouped = false;

  constructor(
    private readonly tables: ReadonlyMap<string, Table>,
    private readonly temporal: boolean,
  ) {}

  report(message: string, span: SqlSpan): void {
    const length = span.end - span.start;
    const repeated = this.diagnostics.some(
      (d) => d.message === message && d.start === span.start && d.length === length,
    );
    if (!repeated) this.diagnostics.push({ message, start: span.start, length });
  }

  type(config: SqlFieldConfig, mode: "select" | "write", nested = false): string {
    let base: string;
    if (config.type === "enum") {
      base = (config.allowedValues ?? []).map((v) => JSON.stringify(v.value)).join(" | ");
    } else if (config.type === "nested") {
      const members = Object.entries(config.fields ?? {}).map(([name, field]) =>
        isRequired(field)
          ? `${propertyKey(name)}: ${this.type(field, mode, true)}`
          : `${propertyKey(name)}?: ${nullable(this.type(field, mode, true))}`,
      );
      base = `{ ${members.join("; ")} }`;
    } else {
      const columnType = mapFieldTypeToColumnType(config.type, this.temporal, nested);
      if (columnType.startsWith("Temporal")) this.usesTemporal = true;
      base = COLUMN_TYPE_ALIASES.get(columnType)?.[mode] ?? columnType;
    }
    if (!config.array) return base;
    return base.includes(" | ") ? `(${base})[]` : `${base}[]`;
  }

  // The definition of a field TailorDB's analyzer typed: the table's own for a field of a table,
  // which keeps the order of nested fields.
  #definitionOf(field: PlatformField): SqlFieldConfig {
    const config = this.tables.get(field.table)?.fields.get(field.name);
    if (config && config.type === field.type && Boolean(config.array) === field.array) {
      return config;
    }
    return toFieldConfig(field);
  }

  // Type each placeholder name from the fields TailorDB's analyzer bound its occurrences to.
  params(names: string[], spans: SqlSpan[], bound: PlatformAnalysis["params"]): SqlTypedName[] {
    const params = new Map<string, { base: string; nullable: boolean }>();
    for (const { index, schema } of bound) {
      const name = assertDefined(names[index - 1], `name of placeholder $${index}`);
      const config = this.#definitionOf(schema);
      const base =
        config.type === "decimal" && !config.array ? "string | number" : this.type(config, "write");
      const existing = params.get(name);
      if (!existing) {
        params.set(name, { base, nullable: !isRequired(config) });
      } else if (existing.base !== base) {
        this.report(
          `Placeholder :${name} is used as both ${existing.base} and ${base}; use separate placeholders`,
          assertDefined(spans[index - 1], `span of placeholder $${index}`),
        );
      } else {
        existing.nullable &&= !isRequired(config);
      }
    }
    return [...new Set(names)].map((name) => {
      const param = params.get(name);
      if (param === undefined) throw new Error(`No type was inferred for placeholder :${name}`);
      return { name, type: param.nullable ? nullable(param.base) : param.base };
    });
  }

  #table(identifier: SqlIdentifier): Table {
    const table = this.tables.get(identifier.name);
    if (!table)
      throw new Error(`TailorDB's analyzer accepted the unknown table ${identifier.name}`);
    return table;
  }

  #bind(scope: Source[], ref: SqlTableRef): Source {
    const source = {
      table: this.#table(ref.table),
      name: (ref.alias ?? ref.table).name,
      nullable: false,
    };
    scope.push(source);
    return source;
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

  // The source and field of a column TailorDB's analyzer accepted.
  #resolve(scope: Source[], ref: SqlColumnRef): { source: Source; config: SqlFieldConfig } {
    const { found } = this.#lookup(scope, ref);
    if (!found) throw new Error(`TailorDB's analyzer accepted the column ${ref.column.name}`);
    return found;
  }

  #nullable(source: Source, column: string, config: SqlFieldConfig): boolean {
    if (this.#notNull.get(source)?.has(column)) return false;
    return source.nullable || !isRequired(config);
  }

  // Whether a value of the select list or RETURNING can be null on a row.
  #nullableValue(scope: Source[], expr: SqlExpression): boolean {
    switch (expr.kind) {
      case "column": {
        const { source, config } = this.#resolve(scope, expr);
        return this.#nullable(source, expr.column.name, config);
      }
      case "unary":
        return this.#nullableValue(scope, expr.operand);
      case "binary":
        return this.#nullableValue(scope, expr.left) || this.#nullableValue(scope, expr.right);
      case "aggregate":
        return (
          expr.fn !== "count" &&
          (!this.#grouped || (expr.arg !== undefined && this.#nullableValue(scope, expr.arg)))
        );
      default:
        return false;
    }
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

  #starSources(scope: Source[], table: SqlIdentifier | undefined): Source[] {
    return table ? scope.filter((source) => source.name === table.name) : scope;
  }

  // The result columns of a select list or RETURNING. TailorDB's analyzer gives the name and type
  // of each column in order; `*` is listed from the definitions instead, as TailorDB expands it in
  // an order of its own.
  columns(
    scope: Source[],
    items: SqlSelectItem[],
    typed: PlatformAnalysis["columns"],
  ): SqlTypedName[] {
    const columns: SqlTypedName[] = [];
    const seen = new Set<string>();
    let next = 0;
    for (const item of items) {
      const { expr } = item;
      const duplicates: string[] = [];
      const add = (name: string, config: SqlFieldConfig, isNullable: boolean) => {
        if (seen.has(name)) {
          duplicates.push(name);
          return;
        }
        seen.add(name);
        const selected = this.type(config, "select");
        columns.push({ name, type: isNullable ? nullable(selected) : selected });
      };
      if (expr.kind === "star") {
        for (const source of this.#starSources(scope, expr.table)) {
          for (const [name, config] of source.table.fields) {
            add(name, config, this.#nullable(source, name, config));
            next++;
          }
        }
      } else {
        const column = typed[next++];
        if (!column) throw new Error("TailorDB's analyzer returned fewer columns than selected");
        add(column.name, this.#definitionOf(column.schema), this.#nullableValue(scope, expr));
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
    if (next !== typed.length) {
      throw new Error(
        `TailorDB's analyzer returned ${typed.length} columns where the statement selects ${next}`,
      );
    }
    return columns;
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

  statement(
    statement: SqlStatement,
    typed: PlatformAnalysis["columns"],
  ): { columns: SqlTypedName[]; cardinality: SqlCardinality } {
    switch (statement.kind) {
      case "select":
        return this.#select(statement, typed);
      case "insert": {
        const table = this.#table(statement.table);
        if (!statement.returning) return { columns: [], cardinality: "none" };
        const scope: Source[] = [{ table, name: table.definition.name, nullable: false }];
        const columns = this.columns(scope, statement.returning, typed);
        const single = statement.rows === "default" || statement.rows.length === 1;
        const skippable = statement.onConflict?.action.kind === "nothing";
        return { columns, cardinality: single ? (skippable ? "maybeOne" : "one") : "many" };
      }
      case "update":
      case "delete": {
        const table = this.#table(statement.table);
        const scope: Source[] = [{ table, name: table.definition.name, nullable: false }];
        if (statement.kind === "update") {
          // TailorDB accepts arithmetic on any field, and fails to run it on a non-numeric one.
          for (const set of statement.sets) {
            if (set.value.kind !== "arithmetic") continue;
            const config = table.fields.get(set.column.name);
            if (config && !isNumeric(config)) {
              this.report(
                `Arithmetic needs an Integer, Float or Decimal field, and ${quoteName(set.column.name)} is ${typeOf(config)}`,
                set.value.span,
              );
            }
          }
        }
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
        const columns = this.columns(scope, statement.returning, typed);
        return {
          columns,
          cardinality: this.atMostOneRow(scope, statement.where, []) ? "maybeOne" : "many",
        };
      }
    }
  }

  // HAVING groups the rows into one group even without GROUP BY or an aggregate in the select
  // list. TailorDB's analyzer does not treat such a query as grouped, and it fails when run.
  #checkHavingGroups(
    scope: Source[],
    statement: Extract<SqlStatement, { kind: "select" }>,
    outputs: ReadonlySet<string>,
  ): void {
    // Qualified by its source, as TailorDB qualifies the columns GROUP BY misses.
    const ungrouped: { name: string; span: SqlSpan }[] = [];
    const add = (ref: SqlColumnRef) => {
      const { source } = this.#resolve(scope, ref);
      ungrouped.push({ name: `${source.name}.${ref.column.name}`, span: ref.span });
    };
    for (const { expr } of statement.items) {
      if (expr.kind !== "star") {
        for (const ref of columnsOf(expr)) add(ref);
        continue;
      }
      const [first] = this.#starSources(scope, expr.table).flatMap((source) =>
        [...source.table.fields.keys()].map((field) => `${source.name}.${field}`),
      );
      if (first) ungrouped.push({ name: first, span: expr.span });
    }
    for (const { by } of statement.orderBy) {
      if (by.kind === "vector") {
        this.report(
          `cannot order by vector field \`${by.column.column.name}\` with HAVING clause`,
          by.span,
        );
      } else if (by.table || !outputs.has(by.column.name)) {
        add(by);
      }
    }
    for (const { name, span } of ungrouped) {
      this.report(
        `field \`${name}\` must appear in the GROUP BY clause or be used in an aggregate function`,
        span,
      );
    }
    for (const lock of statement.locks) {
      this.report("row locks are not allowed with HAVING clause", lock);
    }
  }

  #select(
    statement: Extract<SqlStatement, { kind: "select" }>,
    typed: PlatformAnalysis["columns"],
  ): { columns: SqlTypedName[]; cardinality: SqlCardinality } {
    const scope: Source[] = [];
    const joined: JoinedSource[] = [];
    this.#bind(scope, statement.from);
    for (const join of statement.joins) {
      const source = this.#bind(scope, join.table);
      if (join.type === "left" || join.type === "full") source.nullable = true;
      if (join.type === "right" || join.type === "full") {
        for (const preceding of scope.slice(0, -1)) preceding.nullable = true;
      }
      joined.push({ type: join.type, on: join.on, source });
    }
    const aggregated = statement.items.some((item) => item.expr.kind === "aggregate");
    this.#grouped = statement.groupBy.length > 0;
    this.narrow(scope, statement.where);
    const columns = this.columns(scope, statement.items, typed);
    if (statement.having && !this.#grouped && !aggregated) {
      this.#checkHavingGroups(scope, statement, new Set(columns.map((column) => column.name)));
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
  const tables = tablesOf(definitions);
  const failures = runtimeFailures(parsed.statement);
  const rejected = (diagnostics: SqlDiagnostic[]): SqlAnalysisResult => ({
    diagnostics: [...diagnostics, ...failures.map(diagnosticOf)].toSorted(
      (a, b) => a.start - b.start,
    ),
  });
  const named = tableNames(parsed.statement).flatMap((identifier) => {
    const table = tables.get(identifier.name);
    return table ? [{ identifier, namespace: table.namespace }] : [];
  });
  const namespace = named[0]?.namespace;
  const other = named.find((table) => table.namespace !== namespace);
  if (namespace !== undefined && other) {
    return rejected([
      diagnosticOf({
        message: `Query references tables from multiple namespaces: ${namespace}, ${other.namespace}.`,
        span: other.identifier.span,
      }),
    ]);
  }
  const schema = platformSchemaOf(
    namespace === undefined ? [] : (definitions.namespaces.get(namespace) ?? []),
  );
  const result = analyzeWithPlatform(source, JSON.stringify(schema));
  if (!result.ok) {
    return rejected([
      { message: result.message, start: result.start, length: result.end - result.start },
    ]);
  }
  if (namespace === undefined) throw new Error("TailorDB's analyzer accepted a query on no table");
  const analyzer = new Analyzer(tables, definitions.temporal);
  const { columns, cardinality } = analyzer.statement(parsed.statement, result.columns);
  const params = analyzer.params(parsed.paramNames, parsed.paramSpans, result.params);
  if (analyzer.diagnostics.length > 0 || failures.length > 0) {
    return rejected(analyzer.diagnostics);
  }
  return {
    analysis: {
      namespace,
      text: parsed.text,
      paramNames: parsed.paramNames,
      params,
      columns,
      cardinality,
      usesTemporal: analyzer.usesTemporal,
    },
    diagnostics: [],
  };
}
