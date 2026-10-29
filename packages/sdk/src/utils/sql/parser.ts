/**
 * Parser for the SQL TailorDB accepts through `tailordb.Client`, with `:name`
 * placeholders in place of `$n`: TailorDB's own parser reads the file, and its
 * syntax tree becomes the one the analysis reads. Unquoted identifiers keep
 * their case, as TailorDB does not fold them.
 */

import { assertDefined } from "#/utils/assert";
import {
  parseWithPlatform,
  type PlatformAggregate,
  type PlatformArithmeticOp,
  type PlatformBinaryOp,
  type PlatformColumn,
  type PlatformColumnOrValue,
  type PlatformExpr,
  type PlatformIdent,
  type PlatformJoin,
  type PlatformOrderBy,
  type PlatformScalarExpr,
  type PlatformSelectItem,
  type PlatformSpan,
  type PlatformStatement,
  type PlatformTable,
  type PlatformValue,
} from "./platform-sql";

/** A range of the original source, in UTF-16 code units. */
export interface SqlSpan {
  start: number;
  end: number;
}

/** A problem found in a `.sql` file, located in its original source. */
export interface SqlDiagnostic {
  message: string;
  start: number;
  length: number;
}

export interface SqlIdentifier {
  name: string;
  quoted: boolean;
  span: SqlSpan;
}

export interface SqlColumnRef {
  kind: "column";
  table?: SqlIdentifier;
  column: SqlIdentifier;
  span: SqlSpan;
}

interface SqlStar {
  kind: "star";
  table?: SqlIdentifier;
  span: SqlSpan;
}

interface SqlParam {
  kind: "param";
  name: string;
  span: SqlSpan;
}

interface SqlLiteral {
  kind: "literal";
  type: "string" | "number" | "boolean" | "null";
  value: string;
  span: SqlSpan;
}

interface SqlArrayLiteral {
  kind: "array";
  items: SqlValue[];
  span: SqlSpan;
}

/** A literal or placeholder, as VALUES, SET, LIMIT and OFFSET take. */
type SqlValue = SqlParam | SqlLiteral | SqlArrayLiteral;

type SqlAggregateFunction = "count" | "sum" | "avg" | "min" | "max";

interface SqlAggregate {
  kind: "aggregate";
  fn: SqlAggregateFunction;
  distinct: boolean;
  /** Absent for `count(*)`. */
  arg?: SqlExpression;
  span: SqlSpan;
}

interface SqlUnary {
  kind: "unary";
  op: "+" | "-" | "NOT";
  operand: SqlExpression;
  span: SqlSpan;
}

/** Operators that match a string against a pattern. */
const PATTERN_OPERATORS = [
  "LIKE",
  "NOT LIKE",
  "ILIKE",
  "NOT ILIKE",
  "~",
  "!~",
  "~*",
  "!~*",
] as const;

type SqlArithmeticOperator = "+" | "-" | "*" | "/";

interface SqlBinary {
  kind: "binary";
  /** `!=` is read as `<>`, and `~~`, `!~~`, `~~*`, `!~~*` as the LIKE operators. */
  op:
    | SqlArithmeticOperator
    | "="
    | "<>"
    | "<"
    | "<="
    | ">"
    | ">="
    | (typeof PATTERN_OPERATORS)[number]
    | "AND"
    | "OR";
  left: SqlExpression;
  right: SqlExpression;
  span: SqlSpan;
}

interface SqlIn {
  kind: "in";
  not: boolean;
  left: SqlExpression;
  items: SqlExpression[];
  span: SqlSpan;
}

interface SqlBetween {
  kind: "between";
  not: boolean;
  left: SqlExpression;
  low: SqlExpression;
  high: SqlExpression;
  span: SqlSpan;
}

interface SqlIsNull {
  kind: "isNull";
  not: boolean;
  left: SqlExpression;
  span: SqlSpan;
}

export type SqlExpression =
  | SqlColumnRef
  | SqlValue
  | SqlAggregate
  | SqlUnary
  | SqlBinary
  | SqlIn
  | SqlBetween
  | SqlIsNull;

export interface SqlSelectItem {
  expr: SqlStar | SqlExpression;
  alias?: SqlIdentifier;
  span: SqlSpan;
}

export interface SqlTableRef {
  table: SqlIdentifier;
  alias?: SqlIdentifier;
  span: SqlSpan;
}

export interface SqlJoin {
  type: "inner" | "left" | "right" | "full" | "cross";
  table: SqlTableRef;
  on?: SqlExpression;
}

interface SqlVectorSimilarity {
  kind: "vector";
  column: SqlColumnRef;
  value: SqlValue;
  span: SqlSpan;
}

interface SqlOrderItem {
  by: SqlColumnRef | SqlVectorSimilarity;
  desc: boolean;
}

interface SqlSelect {
  kind: "select";
  items: SqlSelectItem[];
  from: SqlTableRef;
  joins: SqlJoin[];
  where?: SqlExpression;
  groupBy: SqlColumnRef[];
  having?: SqlExpression;
  orderBy: SqlOrderItem[];
  limit?: SqlValue;
  offset?: SqlValue;
  /** The `FOR UPDATE` and `FOR SHARE` clauses. */
  locks: SqlSpan[];
  span: SqlSpan;
}

interface SqlDefault {
  kind: "default";
}

interface SqlExcluded {
  kind: "excluded";
  column: SqlIdentifier;
  span: SqlSpan;
}

/** An operand of UPDATE SET arithmetic. */
type SqlSetOperand = SqlValue | SqlColumnRef;

interface SqlSetArithmetic {
  kind: "arithmetic";
  op: SqlArithmeticOperator;
  left: SqlSetOperand;
  right: SqlSetOperand;
  span: SqlSpan;
}

interface SqlAssignment<Value> {
  column: SqlIdentifier;
  value: Value;
  span: SqlSpan;
}

interface SqlValuesRow {
  values: (SqlValue | SqlDefault)[];
  span: SqlSpan;
}

interface SqlInsert {
  kind: "insert";
  table: SqlIdentifier;
  columns: SqlIdentifier[];
  rows: SqlValuesRow[] | "default";
  onConflict?: {
    column: SqlIdentifier;
    action: { kind: "nothing" } | { kind: "update"; sets: SqlAssignment<SqlValue | SqlExcluded>[] };
  };
  returning?: SqlSelectItem[];
  span: SqlSpan;
}

interface SqlUpdate {
  kind: "update";
  table: SqlIdentifier;
  sets: SqlAssignment<SqlSetOperand | SqlSetArithmetic>[];
  where?: SqlExpression;
  returning?: SqlSelectItem[];
  span: SqlSpan;
}

interface SqlDelete {
  kind: "delete";
  table: SqlIdentifier;
  where?: SqlExpression;
  returning?: SqlSelectItem[];
  span: SqlSpan;
}

export type SqlStatement = SqlSelect | SqlInsert | SqlUpdate | SqlDelete;

/** The parsed statement and the text sent to TailorDB, or the problems found. */
export type ParsedSql =
  | {
      statement: SqlStatement;
      /** The statement as sent: from its first token to its last, each `:name` replaced by `$n`. */
      text: string;
      /** The placeholder name each `$n` of `text` binds, in order. */
      paramNames: string[];
      /** Where each `$n` of `text` is written in the source, in order. */
      paramSpans: SqlSpan[];
      diagnostics: [];
    }
  | { statement?: undefined; paramSpans?: undefined; diagnostics: SqlDiagnostic[] };

export const ARITHMETIC_OPERATORS = ["+", "-", "*", "/"];

const TRANSACTION =
  "Transaction statements are not supported in a .sql file; run the query on a transaction instead";

const BINARY_OPERATORS: Readonly<Record<PlatformBinaryOp, SqlBinary["op"]>> = {
  Add: "+",
  Subtract: "-",
  Multiply: "*",
  Divide: "/",
  Eq: "=",
  NotEq: "<>",
  Gt: ">",
  GtEq: ">=",
  Lt: "<",
  LtEq: "<=",
  Like: "LIKE",
  NotLike: "NOT LIKE",
  ILike: "ILIKE",
  NotILike: "NOT ILIKE",
  Regexp: "~",
  NotRegexp: "!~",
  IRegexp: "~*",
  NotIRegexp: "!~*",
  And: "AND",
  Or: "OR",
};

const ARITHMETIC: Readonly<Record<PlatformArithmeticOp, SqlArithmeticOperator>> = {
  Add: "+",
  Subtract: "-",
  Multiply: "*",
  Divide: "/",
};

function spanOf(first: { span: SqlSpan }, last: { span: SqlSpan }): SqlSpan {
  return { start: first.span.start, end: last.span.end };
}

// Turns the parser's syntax tree into the one the analysis reads.
class Converter {
  readonly paramSpans: SqlSpan[] = [];

  constructor(
    readonly source: string,
    readonly paramNames: string[],
  ) {}

  statement(json: PlatformStatement, span: PlatformSpan): SqlStatement | undefined {
    if (typeof json === "string" || "StartTransaction" in json) return undefined;
    if ("Select" in json) {
      const select = json.Select;
      return {
        kind: "select",
        items: select.select_items.map((item) => this.selectItem(item)),
        from: this.tableRef(select.from.table),
        joins: select.from.joins.map((join) => this.join(join)),
        where: this.optionalExpr(select.where_expr),
        groupBy: (select.group_by ?? []).map((column) => this.column(column)),
        having: this.optionalExpr(select.having),
        orderBy: (select.order_by ?? []).map((item) => this.orderItem(item)),
        limit: select.limit ? this.value(select.limit) : undefined,
        offset: select.offset ? this.value(select.offset) : undefined,
        locks: select.locks.map((lock) => lock.span),
        span,
      };
    }
    if ("Insert" in json) {
      const insert = json.Insert;
      const conflict = insert.on_conflict;
      let onConflict: SqlInsert["onConflict"];
      if (conflict) {
        const column = this.identifier(conflict.target.column);
        onConflict =
          conflict.action === "Nothing"
            ? { column, action: { kind: "nothing" } }
            : {
                column,
                action: {
                  kind: "update",
                  sets: conflict.action.Update.map((set) => {
                    const target = this.identifier(set.column.column);
                    const value: SqlValue | SqlExcluded =
                      "Column" in set.value
                        ? {
                            kind: "excluded",
                            column: this.identifier(set.value.Column.column),
                            span: set.value_span,
                          }
                        : this.value(set.value.Value);
                    return {
                      column: target,
                      value,
                      span: { start: target.span.start, end: set.value_span.end },
                    };
                  }),
                },
              };
      }
      return {
        kind: "insert",
        table: this.identifier(insert.table.name),
        columns: insert.columns.map((column) => this.identifier(column.column)),
        rows:
          insert.columns.length === 0
            ? "default"
            : insert.values.map((row) => ({
                values: row.values.map((value) =>
                  value === "Default" ? { kind: "default" } : this.value(value.Value),
                ),
                span: row.span,
              })),
        onConflict,
        returning: this.returning(insert.returning),
        span,
      };
    }
    if ("Update" in json) {
      const update = json.Update;
      return {
        kind: "update",
        table: this.identifier(update.table.name),
        sets: update.assignments.map((assignment) => {
          const column = this.identifier(assignment.column.column);
          const left = this.setOperand(assignment.left_value);
          let value: SqlSetOperand | SqlSetArithmetic = left;
          if (assignment.arithmetic_op && assignment.right_value) {
            const right = this.setOperand(assignment.right_value);
            value = {
              kind: "arithmetic",
              op: ARITHMETIC[assignment.arithmetic_op],
              left,
              right,
              span: spanOf(left, right),
            };
          }
          return { column, value, span: spanOf(column, value) };
        }),
        where: this.optionalExpr(update.where_expr),
        returning: this.returning(update.returning),
        span,
      };
    }
    const remove = json.Delete;
    return {
      kind: "delete",
      table: this.identifier(remove.table.name),
      where: this.optionalExpr(remove.where_expr),
      returning: this.returning(remove.returning),
      span,
    };
  }

  identifier(json: PlatformIdent): SqlIdentifier {
    return { name: json.value, quoted: this.source[json.span.start] === '"', span: json.span };
  }

  column(json: PlatformColumn): SqlColumnRef {
    const column = this.identifier(json.column);
    const table = json.table ? this.identifier(json.table) : undefined;
    return { kind: "column", table, column, span: spanOf(table ?? column, column) };
  }

  value(json: PlatformValue): SqlValue {
    const { kind, span } = json;
    if (kind === "Null") return { kind: "literal", type: "null", value: "null", span };
    if ("Placeholder" in kind) {
      const name = assertDefined(this.paramNames[kind.Placeholder - 1], "placeholder name");
      this.paramSpans[kind.Placeholder - 1] = span;
      return { kind: "param", name, span };
    }
    if ("String" in kind) return { kind: "literal", type: "string", value: kind.String, span };
    if ("Number" in kind) return { kind: "literal", type: "number", value: kind.Number, span };
    if ("Boolean" in kind) {
      return { kind: "literal", type: "boolean", value: String(kind.Boolean), span };
    }
    return { kind: "array", items: kind.Array.map((item) => this.value(item)), span };
  }

  aggregate(json: PlatformAggregate): SqlAggregate {
    const { kind, span } = json;
    if ("Count" in kind) {
      const argument = kind.Count;
      if (argument === "Wildcard") {
        return { kind: "aggregate", fn: "count", distinct: false, arg: undefined, span };
      }
      const { distinct, expr } = argument.Column;
      return { kind: "aggregate", fn: "count", distinct, arg: this.scalar(expr), span };
    }
    const [fn, argument] =
      "Sum" in kind
        ? (["sum", kind.Sum] as const)
        : "Avg" in kind
          ? (["avg", kind.Avg] as const)
          : "Max" in kind
            ? (["max", kind.Max] as const)
            : (["min", kind.Min] as const);
    return {
      kind: "aggregate",
      fn,
      distinct: argument.distinct,
      arg: this.scalar(argument.expr),
      span,
    };
  }

  scalar(json: PlatformScalarExpr): SqlExpression {
    if ("Column" in json) return this.column(json.Column);
    if ("Value" in json) return this.value(json.Value);
    if ("UnaryOp" in json) {
      const { op, expr, span } = json.UnaryOp;
      return { kind: "unary", op: op === "Plus" ? "+" : "-", operand: this.scalar(expr), span };
    }
    const { left, op, right } = json.BinaryOp;
    return this.binary(BINARY_OPERATORS[op], this.scalar(left), this.scalar(right));
  }

  expr(json: PlatformExpr): SqlExpression {
    if ("Column" in json) return this.column(json.Column);
    if ("Value" in json) return this.value(json.Value);
    if ("AggregateFunction" in json) return this.aggregate(json.AggregateFunction);
    if ("UnaryOp" in json) {
      const { op, expr, span } = json.UnaryOp;
      const operator = op === "Plus" ? "+" : op === "Minus" ? "-" : "NOT";
      return { kind: "unary", op: operator, operand: this.expr(expr), span };
    }
    if ("BinaryOp" in json) {
      const { left, op, right } = json.BinaryOp;
      return this.binary(BINARY_OPERATORS[op], this.expr(left), this.expr(right));
    }
    if ("In" in json) {
      const { left, values, negated, span } = json.In;
      const operand = this.expr(left);
      return {
        kind: "in",
        not: negated,
        left: operand,
        items: values.map((value) => this.expr(value)),
        span: { start: operand.span.start, end: span.end },
      };
    }
    if ("Between" in json) {
      const { left, low, high, negated } = json.Between;
      const operand = this.expr(left);
      const upper = this.expr(high);
      return {
        kind: "between",
        not: negated,
        left: operand,
        low: this.expr(low),
        high: upper,
        span: spanOf(operand, upper),
      };
    }
    const { left, negated, span } = json.IsNull;
    const operand = this.expr(left);
    return {
      kind: "isNull",
      not: negated,
      left: operand,
      span: { start: operand.span.start, end: span.end },
    };
  }

  optionalExpr(json: PlatformExpr | null): SqlExpression | undefined {
    return json ? this.expr(json) : undefined;
  }

  binary(op: SqlBinary["op"], left: SqlExpression, right: SqlExpression): SqlBinary {
    return { kind: "binary", op, left, right, span: spanOf(left, right) };
  }

  selectItem(json: PlatformSelectItem): SqlSelectItem {
    let expr: SqlSelectItem["expr"];
    let alias: PlatformIdent | null = null;
    if ("Wildcard" in json) {
      const { table, span } = json.Wildcard;
      expr = { kind: "star", table: table ? this.identifier(table) : undefined, span };
    } else if ("Column" in json) {
      expr = this.column(json.Column.column);
      alias = json.Column.alias;
    } else if ("AggregateFunction" in json) {
      expr = this.aggregate(json.AggregateFunction.function);
      alias = json.AggregateFunction.alias;
    } else {
      expr = this.scalar(json.Expression.expr);
      alias = json.Expression.alias;
    }
    const name = alias ? this.identifier(alias) : undefined;
    return { expr, alias: name, span: spanOf(expr, name ?? expr) };
  }

  returning(items: PlatformSelectItem[]): SqlSelectItem[] | undefined {
    return items.length === 0 ? undefined : items.map((item) => this.selectItem(item));
  }

  tableRef(json: PlatformTable): SqlTableRef {
    const table = this.identifier(json.name);
    const alias = json.alias ? this.identifier(json.alias) : undefined;
    return { table, alias, span: spanOf(table, alias ?? table) };
  }

  join(json: PlatformJoin): SqlJoin {
    const table = this.tableRef(json.table);
    const { action } = json;
    if (action === "Cross") return { type: "cross", table };
    if ("Inner" in action) return { type: "inner", table, on: this.expr(action.Inner) };
    if ("Left" in action) return { type: "left", table, on: this.expr(action.Left) };
    if ("Right" in action) return { type: "right", table, on: this.expr(action.Right) };
    return { type: "full", table, on: this.expr(action.Full) };
  }

  orderItem(json: PlatformOrderBy): SqlOrderItem {
    const { target } = json;
    const by: SqlOrderItem["by"] =
      "Column" in target
        ? this.column(target.Column)
        : {
            kind: "vector",
            column: this.column(target.Vector.column),
            value: this.value(target.Vector.value),
            span: target.Vector.span,
          };
    return { by, desc: json.direction === "Desc" };
  }

  setOperand(json: PlatformColumnOrValue): SqlSetOperand {
    return "Column" in json ? this.column(json.Column) : this.value(json.Value);
  }
}

/**
 * Parse one TailorDB SQL statement with `:name` placeholders.
 * @param source - Contents of a `.sql` file
 * @returns The statement and its text as sent, or the problem that stopped parsing
 */
export function parseSql(source: string): ParsedSql {
  const result = parseWithPlatform(source);
  if (!result.ok) {
    return {
      diagnostics: [
        { message: result.message, start: result.start, length: result.end - result.start },
      ],
    };
  }
  const { text, paramNames, span } = result;
  const converter = new Converter(source, paramNames);
  const statement = converter.statement(result.statement, span);
  if (!statement) {
    return {
      diagnostics: [{ message: TRANSACTION, start: span.start, length: span.end - span.start }],
    };
  }
  return { statement, text, paramNames, paramSpans: converter.paramSpans, diagnostics: [] };
}
