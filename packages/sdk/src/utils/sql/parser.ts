/**
 * Parser for the SQL subset TailorDB accepts through `tailordb.Client`: the
 * platform's documented "Supported SQL queries" grammar, plus the arithmetic
 * and select-list literals the platform also runs. Unquoted identifiers keep
 * their case, as TailorDB does not fold them.
 */

import { assertDefined } from "#/utils/assert";

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

export interface SqlParam {
  kind: "param";
  name: string;
  span: SqlSpan;
}

export interface SqlLiteral {
  kind: "literal";
  type: "string" | "number" | "boolean" | "null";
  value: string;
  span: SqlSpan;
}

type SqlAggregateFunction = "count" | "sum" | "avg" | "min" | "max";

export interface SqlAggregate {
  kind: "aggregate";
  fn: SqlAggregateFunction;
  distinct: boolean;
  /** Absent for `count(*)`. */
  arg?: SqlExpression;
  span: SqlSpan;
}

export type SqlValue = SqlColumnRef | SqlParam | SqlLiteral;

export interface SqlArithmetic<Operand = SqlExpression> {
  kind: "arithmetic";
  op: "+" | "-" | "*" | "/";
  left: Operand;
  right: Operand;
  span: SqlSpan;
}

export interface SqlNegation {
  kind: "negation";
  operand: SqlExpression;
  span: SqlSpan;
}

export type SqlExpression = SqlValue | SqlAggregate | SqlArithmetic | SqlNegation;

export type SqlCondition =
  | { kind: "compare"; op: string; left: SqlExpression; right: SqlExpression; span: SqlSpan }
  | { kind: "in"; not: boolean; left: SqlExpression; items: SqlValue[]; span: SqlSpan }
  | {
      kind: "between";
      not: boolean;
      left: SqlExpression;
      low: SqlValue;
      high: SqlValue;
      span: SqlSpan;
    }
  | { kind: "isNull"; not: boolean; left: SqlExpression; span: SqlSpan }
  | { kind: "and" | "or"; left: SqlCondition; right: SqlCondition; span: SqlSpan };

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
  on?: SqlCondition;
  span: SqlSpan;
}

interface SqlVectorSimilarity {
  kind: "vector";
  column: SqlColumnRef;
  value: SqlParam | SqlLiteral;
  span: SqlSpan;
}

interface SqlOrderItem {
  by: SqlColumnRef | SqlVectorSimilarity;
  desc: boolean;
  span: SqlSpan;
}

interface SqlSelect {
  kind: "select";
  items: SqlSelectItem[];
  from: SqlTableRef;
  joins: SqlJoin[];
  where?: SqlCondition;
  groupBy: SqlColumnRef[];
  having?: SqlCondition;
  orderBy: SqlOrderItem[];
  limit?: SqlParam | SqlLiteral;
  offset?: SqlParam | SqlLiteral;
  span: SqlSpan;
}

export interface SqlDefault {
  kind: "default";
  span: SqlSpan;
}

export interface SqlExcluded {
  kind: "excluded";
  column: SqlIdentifier;
  span: SqlSpan;
}

interface SqlAssignment<Value> {
  column: SqlIdentifier;
  value: Value;
  span: SqlSpan;
}

interface SqlValuesRow {
  values: (SqlParam | SqlLiteral | SqlDefault)[];
  span: SqlSpan;
}

interface SqlInsert {
  kind: "insert";
  table: SqlIdentifier;
  columns: SqlIdentifier[];
  rows: SqlValuesRow[] | "default";
  onConflict?: {
    column: SqlIdentifier;
    action:
      | { kind: "nothing" }
      | { kind: "update"; sets: SqlAssignment<SqlParam | SqlLiteral | SqlExcluded>[] };
  };
  returning?: SqlSelectItem[];
  span: SqlSpan;
}

interface SqlUpdate {
  kind: "update";
  table: SqlIdentifier;
  sets: SqlAssignment<SqlValue | SqlArithmetic<SqlValue>>[];
  where?: SqlCondition;
  returning?: SqlSelectItem[];
  span: SqlSpan;
}

interface SqlDelete {
  kind: "delete";
  table: SqlIdentifier;
  where?: SqlCondition;
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
      diagnostics: [];
    }
  | { statement?: undefined; diagnostics: SqlDiagnostic[] };

type Token =
  | { kind: "ident"; text: string; quoted: boolean; start: number; end: number }
  | { kind: "string"; value: string; start: number; end: number }
  | { kind: "number"; text: string; start: number; end: number }
  | { kind: "param"; name: string; start: number; end: number }
  | { kind: "op"; text: string; start: number; end: number }
  | { kind: "eof"; start: number; end: number };

class SqlSyntaxError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
  }
}

const OPERATORS = [
  "!~~*",
  "~~*",
  "!~~",
  "!~*",
  "->>",
  "<>",
  "!=",
  "<=",
  ">=",
  "~~",
  "!~",
  "~*",
  "::",
  "||",
  "->",
  "=",
  "<",
  ">",
  "~",
  "(",
  ")",
  ",",
  ".",
  "*",
  ";",
  "+",
  "-",
  "/",
  "[",
  "]",
  "%",
  "^",
  "|",
  "&",
  "#",
  "@",
  "?",
];

const COMPARISON_OPERATORS = new Set([
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
  "~~",
  "!~~",
  "~~*",
  "!~~*",
  "~",
  "!~",
  "~*",
  "!~*",
]);

/** Operators that match a column against a pattern. */
export const PATTERN_OPERATORS: ReadonlySet<string> = new Set([
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

const ARITHMETIC_OPERATORS = ["+", "-", "*", "/"];
const CONDITION_KEYWORDS = ["AND", "OR", "NOT", "IS", "IN", "BETWEEN", "LIKE", "ILIKE"];

const AGGREGATES = new Set<string>(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/** What an expression may not contain where it is parsed, as the message reporting it. */
interface ExpressionRules {
  params?: string;
  aggregates?: string;
}

const AGGREGATE_ARITHMETIC = "Arithmetic on an aggregate is only supported in HAVING";
const SELECT_LIST: ExpressionRules = {
  params: "Placeholders are not supported in the select list",
  aggregates: AGGREGATE_ARITHMETIC,
};
const AGGREGATE_ARGUMENT: ExpressionRules = {
  params: "Placeholders are not supported in an aggregate",
  aggregates: "Aggregates cannot be nested",
};
const ROW_CONDITION: ExpressionRules = {
  aggregates: "Aggregates are only allowed in HAVING and the select list",
};
const GROUP_CONDITION: ExpressionRules = {};

const RESERVED = new Set([
  "ALL",
  "AND",
  "ANY",
  "AS",
  "ASC",
  "BETWEEN",
  "BY",
  "CROSS",
  "DEFAULT",
  "DELETE",
  "DESC",
  "DISTINCT",
  "EXCEPT",
  "FALSE",
  "FETCH",
  "FOR",
  "FROM",
  "FULL",
  "GROUP",
  "HAVING",
  "ILIKE",
  "IN",
  "INNER",
  "INSERT",
  "INTERSECT",
  "INTO",
  "IS",
  "JOIN",
  "LEFT",
  "LIKE",
  "LIMIT",
  "NATURAL",
  "NOT",
  "NULL",
  "NULLS",
  "OFFSET",
  "ON",
  "OR",
  "ORDER",
  "OUTER",
  "RETURNING",
  "RIGHT",
  "SELECT",
  "SET",
  "TRUE",
  "UNION",
  "UPDATE",
  "USING",
  "VALUES",
  "WHERE",
  "WINDOW",
  "WITH",
]);

const IDENT_START = /[A-Za-z_\u0080-￿]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-￿]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if (source.startsWith("--", i)) {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) throw new SqlSyntaxError("Unterminated comment", i, source.length);
      i = close + 2;
    } else if (c === "'" || c === '"') {
      const start = i;
      let value = "";
      for (i++; ; i++) {
        if (i >= source.length) {
          throw new SqlSyntaxError(
            c === "'" ? "Unterminated string literal" : "Unterminated quoted identifier",
            start,
            source.length,
          );
        }
        if (source[i] === c) {
          if (source[i + 1] !== c) break;
          i++;
        }
        value += source[i];
      }
      i++;
      tokens.push(
        c === "'"
          ? { kind: "string", value, start, end: i }
          : { kind: "ident", text: value, quoted: true, start, end: i },
      );
    } else if (c === ":" && source[i + 1] !== ":" && IDENT_START.test(source.charAt(i + 1))) {
      const start = i;
      for (i += 2; i < source.length && IDENT_PART.test(source.charAt(i)); i++);
      tokens.push({ kind: "param", name: source.slice(start + 1, i), start, end: i });
    } else if (c === "$" && /[0-9]/.test(source.charAt(i + 1))) {
      const start = i;
      for (i++; i < source.length && /[0-9]/.test(source.charAt(i)); i++);
      const text = source.slice(start, i);
      throw new SqlSyntaxError(
        `Use :name placeholders instead of ${text}; each placeholder is bound by name`,
        start,
        i,
      );
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source.charAt(i + 1)))) {
      const start = i;
      for (; i < source.length && /[0-9]/.test(source.charAt(i)); i++);
      if (source[i] === "." && /[0-9]/.test(source.charAt(i + 1))) {
        for (i++; i < source.length && /[0-9]/.test(source.charAt(i)); i++);
      }
      tokens.push({ kind: "number", text: source.slice(start, i), start, end: i });
    } else if (IDENT_START.test(c)) {
      const start = i;
      for (i++; i < source.length && IDENT_PART.test(source.charAt(i)); i++);
      tokens.push({ kind: "ident", text: source.slice(start, i), quoted: false, start, end: i });
    } else {
      const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
      if (!op) throw new SqlSyntaxError(`Unexpected character ${JSON.stringify(c)}`, i, i + 1);
      tokens.push({ kind: "op", text: op, start: i, end: i + op.length });
      i += op.length;
    }
  }
  tokens.push({ kind: "eof", start: source.length, end: source.length });
  return tokens;
}

function describeToken(token: Token): string {
  switch (token.kind) {
    case "eof":
      return "the end of the file";
    case "ident":
      return token.quoted ? `"${token.text}"` : token.text;
    case "string":
      return `'${token.value}'`;
    case "number":
      return token.text;
    case "param":
      return `:${token.name}`;
    case "op":
      return `"${token.text}"`;
  }
}

class Parser {
  #index = 0;

  constructor(private readonly tokens: Token[]) {}

  get #token(): Token {
    return assertDefined(this.tokens[this.#index], "token index out of range");
  }

  #peek(offset = 1): Token {
    return assertDefined(
      this.tokens[Math.min(this.#index + offset, this.tokens.length - 1)],
      "token index out of range",
    );
  }

  #advance(): Token {
    const token = this.#token;
    if (token.kind !== "eof") this.#index++;
    return token;
  }

  #previousEnd(): number {
    return this.tokens[this.#index - 1]?.end ?? 0;
  }

  #isKeyword(keyword: string, token: Token = this.#token): boolean {
    return token.kind === "ident" && !token.quoted && token.text.toUpperCase() === keyword;
  }

  #isOp(text: string, token: Token = this.#token): boolean {
    return token.kind === "op" && token.text === text;
  }

  #acceptKeyword(keyword: string): boolean {
    if (!this.#isKeyword(keyword)) return false;
    this.#advance();
    return true;
  }

  #acceptOp(text: string): boolean {
    if (!this.#isOp(text)) return false;
    this.#advance();
    return true;
  }

  #fail(message: string, token: Token = this.#token): never {
    throw new SqlSyntaxError(message, token.start, token.end);
  }

  #failAt(message: string, span: SqlSpan): never {
    throw new SqlSyntaxError(message, span.start, span.end);
  }

  #unexpected(expected: string, token: Token = this.#token): never {
    if (this.#isOp("::", token)) this.#fail("Casts (::) are not supported by TailorDB SQL", token);
    if (this.#isKeyword("NULLS", token)) {
      this.#fail("NULLS FIRST and NULLS LAST are not supported by TailorDB SQL", token);
    }
    if (this.#isOp("!=", token)) {
      this.#fail('Operator "!=" is not supported by TailorDB SQL; use <>', token);
    }
    this.#fail(`Unexpected ${describeToken(token)}; expected ${expected}`, token);
  }

  #expectKeyword(keyword: string): void {
    if (!this.#acceptKeyword(keyword)) this.#unexpected(keyword);
  }

  #expectOp(text: string): void {
    if (!this.#acceptOp(text)) this.#unexpected(`"${text}"`);
  }

  #isName(token: Token = this.#token): boolean {
    return token.kind === "ident" && (token.quoted || !RESERVED.has(token.text.toUpperCase()));
  }

  #identifier(what: string): SqlIdentifier {
    const token = this.#token;
    if (token.kind !== "ident" || !this.#isName(token)) this.#unexpected(what);
    this.#advance();
    return { name: token.text, span: { start: token.start, end: token.end } };
  }

  #span(start: number): SqlSpan {
    return { start, end: this.#previousEnd() };
  }

  statement(): SqlStatement {
    const token = this.#token;
    if (token.kind === "eof") throw new SqlSyntaxError("The file has no statement", 0, 0);
    let statement: SqlStatement;
    if (this.#isKeyword("SELECT")) statement = this.#select();
    else if (this.#isKeyword("INSERT")) statement = this.#insert();
    else if (this.#isKeyword("UPDATE")) statement = this.#update();
    else if (this.#isKeyword("DELETE")) statement = this.#delete();
    else if (this.#isKeyword("WITH")) this.#fail("WITH is not supported by TailorDB SQL");
    else if (["BEGIN", "START", "COMMIT", "ROLLBACK", "END"].some((k) => this.#isKeyword(k))) {
      this.#fail(
        "Transaction statements are not supported in a .sql file; run the query on a transaction instead",
      );
    } else this.#unexpected("SELECT, INSERT, UPDATE or DELETE");
    this.#acceptOp(";");
    const rest = this.#token;
    if (rest.kind === "eof") return statement;
    if (["UNION", "INTERSECT", "EXCEPT"].some((keyword) => this.#isKeyword(keyword))) {
      this.#fail(`${describeToken(rest).toUpperCase()} is not supported by TailorDB SQL`);
    }
    const previous = this.#previousToken();
    if (previous && this.#isOp(";", previous)) this.#fail("A .sql file must contain one statement");
    this.#unexpected("the end of the statement");
  }

  #previousToken(): Token | undefined {
    return this.tokens[this.#index - 1];
  }

  #select(): SqlSelect {
    const start = this.#token.start;
    this.#expectKeyword("SELECT");
    if (this.#isKeyword("DISTINCT")) this.#fail("SELECT DISTINCT is not supported by TailorDB SQL");
    const items = this.#selectItems();
    this.#expectKeyword("FROM");
    const from = this.#tableRef();
    const joins: SqlJoin[] = [];
    for (;;) {
      const join = this.#join();
      if (!join) break;
      joins.push(join);
    }
    if (this.#isOp(",")) this.#fail("Comma-separated tables are not supported; use JOIN");
    const where = this.#acceptKeyword("WHERE") ? this.#condition(ROW_CONDITION) : undefined;
    const groupBy: SqlColumnRef[] = [];
    if (this.#acceptKeyword("GROUP")) {
      this.#expectKeyword("BY");
      do groupBy.push(this.#columnRef("a column"));
      while (this.#acceptOp(","));
    }
    const having = this.#acceptKeyword("HAVING") ? this.#condition(GROUP_CONDITION) : undefined;
    const orderBy: SqlOrderItem[] = [];
    if (this.#acceptKeyword("ORDER")) {
      this.#expectKeyword("BY");
      do orderBy.push(this.#orderItem());
      while (this.#acceptOp(","));
    }
    const limit = this.#acceptKeyword("LIMIT") ? this.#count("LIMIT") : undefined;
    const offset = this.#acceptKeyword("OFFSET") ? this.#count("OFFSET") : undefined;
    while (this.#acceptKeyword("FOR")) {
      if (!this.#acceptKeyword("UPDATE") && !this.#acceptKeyword("SHARE")) {
        this.#unexpected("UPDATE or SHARE");
      }
    }
    return {
      kind: "select",
      items,
      from,
      joins,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
      span: this.#span(start),
    };
  }

  #selectItems(): SqlSelectItem[] {
    const items: SqlSelectItem[] = [];
    do items.push(this.#selectItem());
    while (this.#acceptOp(","));
    return items;
  }

  #selectItem(): SqlSelectItem {
    const token = this.#token;
    const start = token.start;
    let expr: SqlSelectItem["expr"];
    if (this.#acceptOp("*")) {
      expr = { kind: "star", span: this.#span(start) };
    } else if (
      token.kind === "ident" &&
      this.#isOp(".", this.#peek()) &&
      this.#isOp("*", this.#peek(2))
    ) {
      const table = this.#identifier("a table");
      this.#advance();
      this.#advance();
      expr = { kind: "star", table, span: this.#span(start) };
    } else if (this.#isAggregateStart()) {
      expr = this.#aggregate();
      if (this.#isArithmeticOperator()) this.#fail(AGGREGATE_ARITHMETIC);
    } else {
      expr = this.#expression(SELECT_LIST);
      if (expr.kind === "literal" && expr.type === "null") {
        this.#failAt("NULL is not supported in the select list", expr.span);
      }
    }
    const alias = this.#alias();
    return { expr, alias, span: this.#span(start) };
  }

  #alias(): SqlIdentifier | undefined {
    if (this.#acceptKeyword("AS")) return this.#identifier("an alias");
    return this.#isName() ? this.#identifier("an alias") : undefined;
  }

  #isArithmeticOperator(): boolean {
    return ARITHMETIC_OPERATORS.some((op) => this.#isOp(op));
  }

  #isAggregateStart(): boolean {
    const token = this.#token;
    return (
      token.kind === "ident" &&
      !token.quoted &&
      AGGREGATES.has(token.text.toUpperCase()) &&
      this.#isOp("(", this.#peek())
    );
  }

  #unsupportedFunction(): never {
    const token = this.#token;
    const name = token.kind === "ident" ? token.text : "";
    this.#fail(
      `Function "${name}" is not supported by TailorDB SQL; only COUNT, SUM, AVG, MIN and MAX are`,
    );
  }

  #aggregate(): SqlAggregate {
    const nameToken = this.#advance();
    const fn = (
      nameToken.kind === "ident" ? nameToken.text : ""
    ).toLowerCase() as SqlAggregateFunction;
    this.#expectOp("(");
    const distinct = this.#acceptKeyword("DISTINCT");
    let arg: SqlExpression | undefined;
    if (fn === "count" && !distinct && this.#acceptOp("*")) {
      arg = undefined;
    } else {
      arg = this.#expression(AGGREGATE_ARGUMENT);
    }
    this.#expectOp(")");
    return { kind: "aggregate", fn, distinct, arg, span: this.#span(nameToken.start) };
  }

  #columnRef(expected: string): SqlColumnRef {
    const start = this.#token.start;
    if (this.#token.kind === "ident" && this.#isOp("(", this.#peek())) this.#unsupportedFunction();
    const first = this.#identifier(expected);
    if (!this.#acceptOp(".")) return { kind: "column", column: first, span: this.#span(start) };
    const column = this.#identifier("a column");
    return { kind: "column", table: first, column, span: this.#span(start) };
  }

  #tableRef(): SqlTableRef {
    const start = this.#token.start;
    if (this.#isOp("(")) {
      if (this.#isKeyword("SELECT", this.#peek())) this.#subquery(this.#peek());
      this.#unexpected("a table");
    }
    const table = this.#identifier("a table");
    if (this.#isOp("."))
      this.#fail("Schema-qualified table names are not supported by TailorDB SQL");
    const alias = this.#alias();
    return { table, alias, span: this.#span(start) };
  }

  #subquery(token: Token): never {
    this.#fail("Subqueries are not supported by TailorDB SQL", token);
  }

  #join(): SqlJoin | undefined {
    const start = this.#token.start;
    let type: SqlJoin["type"];
    if (this.#acceptKeyword("JOIN")) type = "inner";
    else if (this.#acceptKeyword("INNER")) type = "inner";
    else if (this.#acceptKeyword("LEFT")) type = "left";
    else if (this.#acceptKeyword("RIGHT")) type = "right";
    else if (this.#acceptKeyword("FULL")) type = "full";
    else if (this.#acceptKeyword("CROSS")) type = "cross";
    else return undefined;
    if (this.#previousToken() && !this.#isKeyword("JOIN", this.#previousToken())) {
      if (type !== "inner" && type !== "cross") this.#acceptKeyword("OUTER");
      this.#expectKeyword("JOIN");
    }
    const table = this.#tableRef();
    if (type === "cross") return { type, table, span: this.#span(start) };
    this.#expectKeyword("ON");
    const on = this.#condition(ROW_CONDITION);
    return { type, table, on, span: this.#span(start) };
  }

  #orderItem(): SqlOrderItem {
    const start = this.#token.start;
    let by: SqlOrderItem["by"];
    const token = this.#token;
    if (
      token.kind === "ident" &&
      !token.quoted &&
      token.text.toLowerCase() === "vector_similarity" &&
      this.#isOp("(", this.#peek())
    ) {
      this.#advance();
      this.#advance();
      const column = this.#columnRef("a column");
      this.#expectOp(",");
      const valueToken = this.#token;
      const value = this.#value();
      if (value.kind === "column") this.#unexpected("a placeholder or a string", valueToken);
      this.#expectOp(")");
      by = { kind: "vector", column, value, span: this.#span(token.start) };
    } else {
      by = this.#columnRef("a column");
      if (this.#isArithmeticOperator()) {
        this.#fail(
          "ORDER BY takes a column or a result column name; name the expression with AS and order by that name",
        );
      }
    }
    const desc = this.#acceptKeyword("DESC");
    if (!desc) this.#acceptKeyword("ASC");
    if (this.#isKeyword("NULLS")) this.#unexpected("");
    return { by, desc, span: this.#span(start) };
  }

  #count(clause: string): SqlParam | SqlLiteral {
    const token = this.#token;
    if (token.kind === "param") {
      this.#advance();
      return { kind: "param", name: token.name, span: { start: token.start, end: token.end } };
    }
    if (token.kind === "number" && /^[0-9]+$/.test(token.text)) {
      this.#advance();
      return {
        kind: "literal",
        type: "number",
        value: token.text,
        span: { start: token.start, end: token.end },
      };
    }
    this.#unexpected(`an integer or a placeholder after ${clause}`);
  }

  #condition(rules: ExpressionRules): SqlCondition {
    let left = this.#conjunction(rules);
    while (this.#isKeyword("OR")) {
      this.#advance();
      const right = this.#conjunction(rules);
      left = { kind: "or", left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  #conjunction(rules: ExpressionRules): SqlCondition {
    let left = this.#predicate(rules);
    while (this.#isKeyword("AND")) {
      this.#advance();
      const right = this.#predicate(rules);
      left = { kind: "and", left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  #predicate(rules: ExpressionRules): SqlCondition {
    const start = this.#token.start;
    if (this.#isOp("(")) {
      if (this.#isKeyword("SELECT", this.#peek())) this.#subquery(this.#peek());
      if (this.#parenthesizesCondition()) {
        this.#advance();
        const inner = this.#condition(rules);
        this.#expectOp(")");
        return { ...inner, span: this.#span(start) };
      }
    }
    if (this.#isKeyword("NOT")) {
      this.#fail(
        "NOT before a condition is not supported by TailorDB SQL; use NOT IN, NOT BETWEEN, NOT LIKE, NOT ILIKE or IS NOT NULL",
      );
    }
    const left = this.#expression(rules);
    if (left.kind === "param" || left.kind === "literal") {
      this.#failAt(
        "The left side of a condition must be a column, an aggregate or arithmetic",
        left.span,
      );
    }
    if (this.#acceptKeyword("IS")) {
      const not = this.#acceptKeyword("NOT");
      this.#expectKeyword("NULL");
      return { kind: "isNull", not, left, span: this.#span(start) };
    }
    const not = this.#acceptKeyword("NOT");
    if (this.#acceptKeyword("IN")) {
      this.#expectOp("(");
      if (this.#isKeyword("SELECT")) this.#subquery(this.#token);
      const items: SqlValue[] = [];
      do items.push(this.#value());
      while (this.#acceptOp(","));
      this.#expectOp(")");
      return { kind: "in", not, left, items, span: this.#span(start) };
    }
    if (this.#acceptKeyword("BETWEEN")) {
      const low = this.#value();
      this.#expectKeyword("AND");
      const high = this.#value();
      return { kind: "between", not, left, low, high, span: this.#span(start) };
    }
    for (const keyword of ["LIKE", "ILIKE"]) {
      if (this.#acceptKeyword(keyword)) {
        const op = not ? `NOT ${keyword}` : keyword;
        return {
          kind: "compare",
          op,
          left,
          right: this.#pattern(op, left),
          span: this.#span(start),
        };
      }
    }
    if (not) this.#unexpected("IN, BETWEEN, LIKE or ILIKE");
    const opToken = this.#token;
    if (opToken.kind !== "op" || !COMPARISON_OPERATORS.has(opToken.text)) {
      this.#unexpected("a comparison operator");
    }
    this.#advance();
    if (
      this.#token.kind === "ident" &&
      !this.#token.quoted &&
      ["ANY", "ALL", "SOME"].includes(this.#token.text.toUpperCase())
    ) {
      this.#unsupportedFunction();
    }
    const op = opToken.text;
    const right = PATTERN_OPERATORS.has(op) ? this.#pattern(op, left) : this.#expression(rules);
    return { kind: "compare", op, left, right, span: this.#span(start) };
  }

  // Whether the parenthesis at the current token encloses a condition rather than an expression.
  #parenthesizesCondition(): boolean {
    let depth = 0;
    for (const token of this.tokens.slice(this.#index)) {
      if (this.#isOp("(", token)) depth++;
      else if (this.#isOp(")", token)) depth--;
      else if (
        (token.kind === "op" && (COMPARISON_OPERATORS.has(token.text) || token.text === "!=")) ||
        CONDITION_KEYWORDS.some((keyword) => this.#isKeyword(keyword, token))
      ) {
        return true;
      }
      if (depth === 0 || token.kind === "eof") return false;
    }
    return false;
  }

  // The pattern a pattern operator matches `left` against.
  #pattern(op: string, left: SqlExpression): SqlValue {
    if (left.kind === "arithmetic" || left.kind === "negation") {
      this.#failAt(`${op} takes a column on its left, not arithmetic`, left.span);
    }
    return this.#value();
  }

  #expression(rules: ExpressionRules): SqlExpression {
    return this.#arithmetic(["+", "-"], () =>
      this.#arithmetic(["*", "/"], () => this.#factor(rules)),
    );
  }

  // A left-associative chain of `operand` joined by `operators`.
  #arithmetic(operators: string[], operand: () => SqlExpression): SqlExpression {
    let left = operand();
    for (;;) {
      const token = this.#token;
      if (token.kind !== "op" || !operators.includes(token.text)) return left;
      this.#advance();
      const right = operand();
      left = {
        kind: "arithmetic",
        op: token.text as SqlArithmetic["op"],
        left: this.#numeric(left),
        right: this.#numeric(right),
        span: { start: left.span.start, end: right.span.end },
      };
    }
  }

  #numeric(operand: SqlExpression): SqlExpression {
    if (operand.kind === "literal" && operand.type === "null") {
      this.#failAt("NULL is not supported in arithmetic", operand.span);
    }
    return operand;
  }

  #factor(rules: ExpressionRules): SqlExpression {
    const token = this.#token;
    if (this.#isOp("-") && this.#peek().kind !== "number") {
      this.#advance();
      const operand = this.#numeric(this.#factor(rules));
      return { kind: "negation", operand, span: this.#span(token.start) };
    }
    if (this.#isOp("(") && !this.#isKeyword("SELECT", this.#peek())) {
      this.#advance();
      const inner = this.#expression(rules);
      this.#expectOp(")");
      return inner;
    }
    if (this.#isAggregateStart()) {
      if (rules.aggregates) this.#fail(rules.aggregates);
      return this.#aggregate();
    }
    if (token.kind === "param" && rules.params) this.#fail(rules.params);
    return this.#value();
  }

  #value(): SqlValue {
    const token = this.#token;
    const span = { start: token.start, end: token.end };
    if (token.kind === "param") {
      this.#advance();
      return { kind: "param", name: token.name, span };
    }
    if (token.kind === "string") {
      this.#advance();
      return { kind: "literal", type: "string", value: token.value, span };
    }
    if (token.kind === "number") {
      this.#advance();
      return { kind: "literal", type: "number", value: token.text, span };
    }
    if (this.#isOp("-") && this.#peek().kind === "number") {
      this.#advance();
      const number = this.#advance();
      const text = number.kind === "number" ? number.text : "";
      return {
        kind: "literal",
        type: "number",
        value: `-${text}`,
        span: { start: token.start, end: number.end },
      };
    }
    if (this.#isKeyword("TRUE") || this.#isKeyword("FALSE")) {
      this.#advance();
      return {
        kind: "literal",
        type: "boolean",
        value: token.kind === "ident" ? token.text.toLowerCase() : "",
        span,
      };
    }
    if (this.#isKeyword("NULL")) {
      this.#advance();
      return { kind: "literal", type: "null", value: "null", span };
    }
    if (this.#isOp("(") && this.#isKeyword("SELECT", this.#peek())) this.#subquery(this.#peek());
    return this.#columnRef("a column, a literal or a placeholder");
  }

  #insert(): SqlInsert {
    const start = this.#token.start;
    this.#expectKeyword("INSERT");
    this.#expectKeyword("INTO");
    const table = this.#identifier("a table");
    let columns: SqlIdentifier[] = [];
    let rows: SqlInsert["rows"];
    if (this.#acceptKeyword("DEFAULT")) {
      this.#expectKeyword("VALUES");
      rows = "default";
    } else {
      this.#expectOp("(");
      columns = [];
      do columns.push(this.#identifier("a column"));
      while (this.#acceptOp(","));
      this.#expectOp(")");
      this.#expectKeyword("VALUES");
      rows = [];
      do {
        const rowStart = this.#token.start;
        this.#expectOp("(");
        const values: SqlValuesRow["values"] = [];
        do values.push(this.#insertValue());
        while (this.#acceptOp(","));
        this.#expectOp(")");
        rows.push({ values, span: this.#span(rowStart) });
      } while (this.#acceptOp(","));
    }
    let onConflict: SqlInsert["onConflict"];
    if (this.#acceptKeyword("ON")) {
      this.#expectKeyword("CONFLICT");
      this.#expectOp("(");
      const column = this.#identifier("a column");
      if (this.#isOp(",")) this.#fail("ON CONFLICT takes a single column in TailorDB SQL");
      this.#expectOp(")");
      this.#expectKeyword("DO");
      if (this.#acceptKeyword("NOTHING")) {
        onConflict = { column, action: { kind: "nothing" } };
      } else {
        this.#expectKeyword("UPDATE");
        this.#expectKeyword("SET");
        const sets: SqlAssignment<SqlParam | SqlLiteral | SqlExcluded>[] = [];
        do sets.push(this.#conflictAssignment());
        while (this.#acceptOp(","));
        if (this.#isKeyword("WHERE")) {
          this.#fail("WHERE after ON CONFLICT DO UPDATE is not supported by TailorDB SQL");
        }
        onConflict = { column, action: { kind: "update", sets } };
      }
    }
    const returning = this.#returning();
    return { kind: "insert", table, columns, rows, onConflict, returning, span: this.#span(start) };
  }

  #insertValue(): SqlParam | SqlLiteral | SqlDefault {
    const token = this.#token;
    if (this.#acceptKeyword("DEFAULT")) {
      return { kind: "default", span: { start: token.start, end: token.end } };
    }
    const value = this.#value();
    if (value.kind === "column") this.#unexpected("a literal, a placeholder or DEFAULT", token);
    return value;
  }

  #conflictAssignment(): SqlAssignment<SqlParam | SqlLiteral | SqlExcluded> {
    const start = this.#token.start;
    const column = this.#identifier("a column");
    this.#expectOp("=");
    const token = this.#token;
    if (this.#isKeyword("EXCLUDED") && this.#isOp(".", this.#peek())) {
      this.#advance();
      this.#advance();
      const excludedColumn = this.#identifier("a column");
      return {
        column,
        value: { kind: "excluded", column: excludedColumn, span: this.#span(token.start) },
        span: this.#span(start),
      };
    }
    const value = this.#value();
    if (value.kind === "column")
      this.#unexpected("a literal, a placeholder or EXCLUDED.column", token);
    return { column, value, span: this.#span(start) };
  }

  #update(): SqlUpdate {
    const start = this.#token.start;
    this.#expectKeyword("UPDATE");
    const table = this.#identifier("a table");
    this.#expectKeyword("SET");
    const sets: SqlAssignment<SqlValue | SqlArithmetic<SqlValue>>[] = [];
    do {
      const setStart = this.#token.start;
      const column = this.#identifier("a column");
      this.#expectOp("=");
      const left = this.#value();
      const opToken = this.#token;
      if (opToken.kind === "op" && ["+", "-", "*", "/"].includes(opToken.text)) {
        this.#advance();
        const right = this.#value();
        sets.push({
          column,
          value: {
            kind: "arithmetic",
            op: opToken.text as SqlArithmetic["op"],
            left,
            right,
            span: { start: left.span.start, end: right.span.end },
          },
          span: this.#span(setStart),
        });
      } else {
        sets.push({ column, value: left, span: this.#span(setStart) });
      }
    } while (this.#acceptOp(","));
    const where = this.#acceptKeyword("WHERE") ? this.#condition(ROW_CONDITION) : undefined;
    const returning = this.#returning();
    return { kind: "update", table, sets, where, returning, span: this.#span(start) };
  }

  #delete(): SqlDelete {
    const start = this.#token.start;
    this.#expectKeyword("DELETE");
    this.#expectKeyword("FROM");
    const table = this.#identifier("a table");
    const where = this.#acceptKeyword("WHERE") ? this.#condition(ROW_CONDITION) : undefined;
    const returning = this.#returning();
    return { kind: "delete", table, where, returning, span: this.#span(start) };
  }

  #returning(): SqlSelectItem[] | undefined {
    return this.#acceptKeyword("RETURNING") ? this.#selectItems() : undefined;
  }
}

/**
 * Parse one TailorDB SQL statement with `:name` placeholders.
 * @param source - Contents of a `.sql` file
 * @returns The statement and its text as sent, or the problem that stopped parsing
 */
export function parseSql(source: string): ParsedSql {
  let tokens: Token[];
  let statement: SqlStatement;
  try {
    tokens = tokenize(source);
    statement = new Parser(tokens).statement();
  } catch (error) {
    if (!(error instanceof SqlSyntaxError)) throw error;
    return {
      diagnostics: [
        { message: error.message, start: error.start, length: error.end - error.start },
      ],
    };
  }
  const { start, end } = statement.span;
  const paramNames: string[] = [];
  let text = "";
  let at = start;
  for (const token of tokens) {
    if (token.kind !== "param" || token.start < start || token.end > end) continue;
    paramNames.push(token.name);
    text += `${source.slice(at, token.start)}$${paramNames.length}`;
    at = token.end;
  }
  text += source.slice(at, end);
  return { statement, text, paramNames, diagnostics: [] };
}
