import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "#/utils/field-column-type";
import {
  parseSql,
  type SqlAggregate,
  type SqlColumnRef,
  type SqlCondition,
  type SqlDiagnostic,
  type SqlIdentifier,
  type SqlLiteral,
  type SqlOperand,
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
const COMPARABLE_TYPES = ["integer", "float", "string", "enum", "date", "time", "datetime"];
const COMPARABLE_LABEL = "an Integer, Float, String, Enum, Date, Time or DateTime field";
const NUMERIC_TYPES = ["integer", "float"];
const ARITHMETIC_TYPES = ["integer", "float", "decimal"];
const PATTERN_OPERATORS = new Set([
  "LIKE",
  "NOT LIKE",
  "ILIKE",
  "NOT ILIKE",
  "~~",
  "!~~",
  "~~*",
  "!~~*",
  "~",
  "!~",
  "~*",
  "!~*",
]);

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

class Analyzer {
  readonly diagnostics: SqlDiagnostic[] = [];
  usesTemporal = false;
  readonly #tables = new Map<string, Table>();
  readonly #params = new Map<string, { type: string }>();
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
    return [...new Set(names)].map((name) => ({
      name,
      type: this.#params.get(name)?.type ?? "unknown",
    }));
  }

  param(param: SqlParam, type: string): void {
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
    if (scope.some((source) => source.table === table)) {
      this.report(
        `Joining ${quoteName(table.definition.name)} more than once is not supported by TailorDB SQL`,
        ref.table.span,
      );
      return;
    }
    scope.push({ table, name: ref.alias?.name ?? ref.table.name, nullable: false });
  }

  column(
    scope: Source[],
    ref: SqlColumnRef,
    outputNames?: ReadonlySet<string>,
  ): { config: SqlFieldConfig; nullable: boolean; source: Source } | undefined {
    if (ref.table) {
      const table = ref.table;
      const source = scope.find((candidate) => candidate.name === table.name);
      if (!source) {
        if (scope.length > 0) {
          this.report(`Table or alias "${table.name}" is not in the query`, table.span);
        }
        return undefined;
      }
      return this.#field(source, ref.column);
    }
    const owners = scope.filter((source) => source.table.fields.has(ref.column.name));
    const [owner] = owners;
    if (owner && owners.length === 1) return this.#field(owner, ref.column);
    if (owners.length > 1) {
      this.report(
        `Column ${quoteName(ref.column.name)} is ambiguous: it exists in ${owners.map((owner) => quoteName(owner.table.definition.name)).join(" and ")}`,
        ref.column.span,
      );
      return undefined;
    }
    if (outputNames?.has(ref.column.name)) return undefined;
    if (scope.length > 0) {
      const [only] = scope;
      const where =
        only && scope.length === 1
          ? quoteName(only.table.definition.name)
          : "any table of the query";
      this.report(
        `Column ${quoteName(ref.column.name)} does not exist in ${where}`,
        ref.column.span,
      );
    }
    return undefined;
  }

  #field(source: Source, column: SqlIdentifier) {
    const config = source.table.fields.get(column.name);
    if (!config) {
      this.report(
        `Column ${quoteName(column.name)} does not exist in ${quoteName(source.table.definition.name)}`,
        column.span,
      );
      return undefined;
    }
    return { config, nullable: source.nullable || config.required !== true, source };
  }

  // The aggregate's result type, or undefined when its argument cannot be aggregated.
  aggregate(
    scope: Source[],
    aggregate: SqlAggregate,
  ): { select: string; write: string } | undefined {
    if (aggregate.fn === "count") {
      if (aggregate.arg) this.column(scope, aggregate.arg);
      return { select: "number", write: "number" };
    }
    const arg = aggregate.arg ? this.column(scope, aggregate.arg) : undefined;
    if (!arg) return undefined;
    const fieldType = `${arg.config.type}${arg.config.array ? "[]" : ""}`;
    const name = aggregate.fn.toUpperCase();
    if (aggregate.fn === "sum" || aggregate.fn === "avg") {
      if (arg.config.array || !NUMERIC_TYPES.includes(arg.config.type)) {
        this.report(`${name} takes an Integer or Float field, not ${fieldType}`, aggregate.span);
        return undefined;
      }
      return { select: nullable("number"), write: "number" };
    }
    if (arg.config.array || !COMPARABLE_TYPES.includes(arg.config.type)) {
      this.report(`${name} takes ${COMPARABLE_LABEL}, not ${fieldType}`, aggregate.span);
      return undefined;
    }
    return {
      select: nullable(this.type(arg.config, "select")),
      write: this.type(arg.config, "write"),
    };
  }

  literal(config: SqlFieldConfig, columnName: string, literal: SqlLiteral): void {
    if (config.type !== "enum" || literal.type !== "string") return;
    const values = (config.allowedValues ?? []).map((v) => v.value);
    if (!values.includes(literal.value)) {
      this.report(
        `'${literal.value}' is not a value of ${quoteName(columnName)}: ${values.join(", ")}`,
        literal.span,
      );
    }
  }

  value(
    scope: Source[],
    value: SqlValue,
    paramType: string | undefined,
    target?: { config: SqlFieldConfig; name: string },
  ): void {
    if (value.kind === "param") {
      if (paramType !== undefined) this.param(value, paramType);
    } else if (value.kind === "literal") {
      if (target) this.literal(target.config, target.name, value);
    } else {
      this.column(scope, value);
    }
  }

  condition(
    scope: Source[],
    condition: SqlCondition | undefined,
    outputNames?: ReadonlySet<string>,
  ): void {
    if (!condition) return;
    switch (condition.kind) {
      case "and":
      case "or":
        this.condition(scope, condition.left, outputNames);
        this.condition(scope, condition.right, outputNames);
        return;
      case "isNull":
        this.#operand(scope, condition.left, false);
        return;
      case "compare": {
        const left = this.#operand(scope, condition.left, true);
        const paramType = PATTERN_OPERATORS.has(condition.op) ? "string" : left?.paramType;
        this.value(scope, condition.right, paramType, left?.target);
        return;
      }
      case "in": {
        const left = this.#operand(scope, condition.left, true);
        for (const item of condition.items) this.value(scope, item, left?.paramType, left?.target);
        return;
      }
      case "between": {
        const left = this.#operand(scope, condition.left, true);
        this.value(scope, condition.low, left?.paramType, left?.target);
        this.value(scope, condition.high, left?.paramType, left?.target);
        return;
      }
    }
  }

  #operand(
    scope: Source[],
    operand: SqlOperand,
    compared: boolean,
  ): { paramType: string; target?: { config: SqlFieldConfig; name: string } } | undefined {
    if (operand.kind === "aggregate") {
      const type = this.aggregate(scope, operand);
      return type && { paramType: type.write };
    }
    if (operand.kind !== "column") return undefined;
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
    const add = (item: SqlSelectItem, name: string, type: string | undefined) => {
      if (seen.has(name)) {
        this.report(
          `Column ${quoteName(name)} appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS`,
          item.span,
        );
        return;
      }
      seen.add(name);
      if (type !== undefined) columns.push({ name, type });
    };
    for (const item of items) {
      const { expr } = item;
      if (expr.kind === "star") {
        const tableName = expr.table?.name;
        const sources =
          tableName === undefined ? scope : scope.filter((source) => source.name === tableName);
        if (expr.table && sources.length === 0 && scope.length > 0) {
          this.report(`Table or alias "${expr.table.name}" is not in the query`, expr.table.span);
        }
        for (const source of sources) {
          for (const [name, config] of source.table.fields) {
            const type = this.type(config, "select");
            add(item, name, source.nullable || config.required !== true ? nullable(type) : type);
          }
        }
      } else if (expr.kind === "column") {
        const column = this.column(scope, expr);
        const type = column && this.type(column.config, "select");
        add(
          item,
          item.alias?.name ?? expr.column.name,
          column?.nullable && type ? nullable(type) : type,
        );
      } else {
        add(item, item.alias?.name ?? expr.fn, this.aggregate(scope, expr)?.select);
      }
    }
    return columns;
  }

  // Whether the AND-ed equalities of `where` pin a unique key of the only table.
  keyed(scope: Source[], where: SqlCondition | undefined): boolean {
    if (scope.length !== 1 || !where) return false;
    const [{ table, name }] = scope as [Source];
    const pinned = new Set<string>();
    const visit = (condition: SqlCondition) => {
      if (condition.kind === "and") {
        visit(condition.left);
        visit(condition.right);
      } else if (
        condition.kind === "compare" &&
        condition.op === "=" &&
        condition.left.kind === "column" &&
        (!condition.left.table || condition.left.table.name === name) &&
        condition.right.kind !== "column"
      ) {
        pinned.add(condition.left.column.name);
      }
    };
    visit(where);
    const keys: string[][] = [
      ...[...table.fields]
        .filter(([, config]) => config.unique && !config.array)
        .map(([field]) => [field]),
      ...Object.values(table.definition.indexes ?? {})
        .filter((index) => index.unique)
        .map((index) => index.fields),
    ];
    return keys.some((key) => key.every((field) => pinned.has(field)));
  }

  written(
    scope: Source[],
    column: SqlIdentifier,
    value: SqlValue | { kind: "default" } | { kind: "excluded"; column: SqlIdentifier },
    table: Table,
  ): void {
    const config = table.fields.get(column.name);
    if (value.kind === "default") return;
    if (value.kind === "excluded") {
      if (!table.fields.has(value.column.name)) {
        this.report(
          `Column ${quoteName(value.column.name)} does not exist in ${quoteName(table.definition.name)}`,
          value.column.span,
        );
      }
      return;
    }
    if (!config) {
      if (value.kind === "column") this.column(scope, value);
      return;
    }
    const type = this.type(config, "write");
    this.value(scope, value, config.required === true ? type : nullable(type), {
      config,
      name: column.name,
    });
  }

  writable(table: Table, column: SqlIdentifier): SqlFieldConfig | undefined {
    const config = table.fields.get(column.name);
    if (!config) {
      this.report(
        `Column ${quoteName(column.name)} does not exist in ${quoteName(table.definition.name)}`,
        column.span,
      );
    }
    return config;
  }

  statement(statement: SqlStatement): { columns: SqlTypedName[]; cardinality: SqlCardinality } {
    switch (statement.kind) {
      case "select": {
        const scope: Source[] = [];
        this.bind(scope, statement.from);
        for (const join of statement.joins) {
          this.bind(scope, join.table);
          const joined = scope.at(-1);
          if (joined && joined.name === (join.table.alias?.name ?? join.table.table.name)) {
            if (join.type === "left" || join.type === "full") joined.nullable = true;
            if (join.type === "right" || join.type === "full") {
              for (const source of scope.slice(0, -1)) source.nullable = true;
            }
          }
        }
        for (const join of statement.joins) this.condition(scope, join.on);
        const columns = this.columns(scope, statement.items);
        const outputNames = new Set(columns.map((column) => column.name));
        this.condition(scope, statement.where);
        for (const column of statement.groupBy) this.column(scope, column);
        this.condition(scope, statement.having, outputNames);
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
          if (item.by.value.kind === "param") this.param(item.by.value, "string");
        }
        for (const count of [statement.limit, statement.offset]) {
          if (count?.kind === "param") this.param(count, "number");
        }
        const aggregated = statement.items.some((item) => item.expr.kind === "aggregate");
        let cardinality: SqlCardinality = "many";
        if (aggregated && statement.groupBy.length === 0) {
          cardinality = statement.having || statement.offset ? "maybeOne" : "one";
        } else if (
          this.keyed(scope, statement.where) ||
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
          this.writable(table, column);
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
              if (column) this.written(scope, column, value, table);
            });
          }
        }
        const conflict = statement.onConflict;
        if (conflict) {
          const config = this.writable(table, conflict.column);
          if (config && !config.unique) {
            this.report(
              `ON CONFLICT takes "id" or a unique field, and ${quoteName(conflict.column.name)} is not unique`,
              conflict.column.span,
            );
          }
          if (conflict.action.kind === "update") {
            for (const set of conflict.action.sets) {
              if (this.writable(table, set.column))
                this.written(scope, set.column, set.value, table);
            }
            this.condition(scope, conflict.action.where);
          }
        }
        if (!statement.returning) return { columns: [], cardinality: "none" };
        const columns = this.columns(scope, statement.returning);
        const single = statement.rows === "default" || statement.rows.length === 1;
        const skippable =
          conflict?.action.kind === "nothing" ||
          (conflict?.action.kind === "update" && conflict.action.where !== undefined);
        return { columns, cardinality: single ? (skippable ? "maybeOne" : "one") : "many" };
      }
      case "update":
      case "delete": {
        const table = this.table(statement.table);
        if (!table) return { columns: [], cardinality: "many" };
        const scope: Source[] = [{ table, name: table.definition.name, nullable: false }];
        if (statement.kind === "update") {
          for (const set of statement.sets) {
            const config = this.writable(table, set.column);
            if (!config) continue;
            if (set.value.kind !== "arithmetic") {
              this.written(scope, set.column, set.value, table);
              continue;
            }
            if (config.array || !ARITHMETIC_TYPES.includes(config.type)) {
              this.report(
                `Arithmetic needs an Integer, Float or Decimal field, and ${quoteName(set.column.name)} is ${config.type}${config.array ? "[]" : ""}`,
                set.value.span,
              );
              continue;
            }
            const operandType = this.type(config, "write");
            this.value(scope, set.value.left, operandType);
            this.value(scope, set.value.right, operandType);
          }
        }
        this.condition(scope, statement.where);
        if (!statement.returning) return { columns: [], cardinality: "none" };
        const columns = this.columns(scope, statement.returning);
        return { columns, cardinality: this.keyed(scope, statement.where) ? "maybeOne" : "many" };
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
