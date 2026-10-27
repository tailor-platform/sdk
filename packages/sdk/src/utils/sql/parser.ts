/**
 * Parser for the SQL TailorDB accepts through `tailordb.Client`, following the
 * grammar the platform's SQL service parses, with `:name` placeholders in
 * place of `$n`. Unquoted identifiers keep their case, as TailorDB does not
 * fold them.
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

interface SqlArrayLiteral {
  kind: "array";
  items: SqlValue[];
  span: SqlSpan;
}

/** A literal or placeholder, as VALUES, SET, LIMIT and OFFSET take. */
export type SqlValue = SqlParam | SqlLiteral | SqlArrayLiteral;

type SqlAggregateFunction = "count" | "sum" | "avg" | "min" | "max";

export interface SqlAggregate {
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
export const PATTERN_OPERATORS = [
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
  span: SqlSpan;
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
  span: SqlSpan;
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
  span: SqlSpan;
}

interface SqlExcluded {
  kind: "excluded";
  column: SqlIdentifier;
  span: SqlSpan;
}

/** An operand of UPDATE SET arithmetic. */
export type SqlSetOperand = SqlValue | SqlColumnRef;

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
      diagnostics: [];
    }
  | { statement?: undefined; diagnostics: SqlDiagnostic[] };

type Token =
  | { kind: "word"; text: string; quoted: boolean; start: number; end: number }
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

const OPERATORS: Readonly<Record<string, SqlBinary["op"]>> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "=": "=",
  "<>": "<>",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "~~": "LIKE",
  "!~~": "NOT LIKE",
  "~~*": "ILIKE",
  "!~~*": "NOT ILIKE",
  "~": "~",
  "!~": "!~",
  "~*": "~*",
  "!~*": "!~*",
};

// Binding power in conditions, as in PostgreSQL: higher binds tighter.
const PRECEDENCE = {
  lowest: 0,
  or: 1,
  and: 2,
  not: 3,
  is: 4,
  comparison: 5,
  pattern: 6,
  additive: 7,
  multiplicative: 8,
  unary: 9,
};

const OPERATOR_PRECEDENCE: Readonly<Record<string, number>> = {
  "+": PRECEDENCE.additive,
  "-": PRECEDENCE.additive,
  "*": PRECEDENCE.multiplicative,
  "/": PRECEDENCE.multiplicative,
  "=": PRECEDENCE.comparison,
  "<>": PRECEDENCE.comparison,
  "!=": PRECEDENCE.comparison,
  "<": PRECEDENCE.comparison,
  "<=": PRECEDENCE.comparison,
  ">": PRECEDENCE.comparison,
  ">=": PRECEDENCE.comparison,
  "~~": PRECEDENCE.pattern,
  "!~~": PRECEDENCE.pattern,
  "~~*": PRECEDENCE.pattern,
  "!~~*": PRECEDENCE.pattern,
  "~": PRECEDENCE.pattern,
  "!~": PRECEDENCE.pattern,
  "~*": PRECEDENCE.pattern,
  "!~*": PRECEDENCE.pattern,
};

const ARITHMETIC_OPERATORS = ["+", "-", "*", "/"];
const AGGREGATES = new Set<string>(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

// Words that end a table reference instead of naming its alias.
const TABLE_ALIAS_STOPS = [
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "FOR",
  "ON",
];

const STANDALONE_AGGREGATE =
  "An aggregate in the select list must stand alone; arithmetic on aggregates is only supported in HAVING";

// Characters an operator absorbs, as PostgreSQL reads user-defined operators.
const OPERATOR_PART = /[+\-*/<>=~!@#%^&|`?]/;
const WHITESPACE = /[ \t\n\r\v\f]/;
const DIGIT = /[0-9]/;
const IDENT_START = /[A-Za-z_\u0080-￿]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-￿]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const at = (offset = 0) => source.charAt(i + offset);
  const push = (start: number) =>
    tokens.push({ kind: "op", text: source.slice(start, i), start, end: i });
  // End an operator that started at `start`, taking in the operator characters that follow.
  const absorb = (start: number) => {
    while (OPERATOR_PART.test(at())) i++;
    push(start);
  };
  const digits = () => {
    while (DIGIT.test(at()) || (at() === "_" && DIGIT.test(at(1)))) i++;
  };
  while (i < source.length) {
    const c = at();
    const start = i;
    if (WHITESPACE.test(c)) {
      i++;
    } else if (source.startsWith("--", i)) {
      while (i < source.length && at() !== "\n" && at() !== "\r") i++;
    } else if (source.startsWith("/*", i)) {
      let depth = 0;
      while (i < source.length) {
        if (source.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (source.startsWith("*/", i)) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else {
          i++;
        }
      }
      if (depth > 0) throw new SqlSyntaxError("Unterminated comment", start, source.length);
    } else if (c === "'" || c === '"') {
      let value = "";
      for (i++; ; i++) {
        if (i >= source.length) {
          throw new SqlSyntaxError(
            c === "'" ? "Unterminated string literal" : "Unterminated quoted identifier",
            start,
            source.length,
          );
        }
        if (at() === c) {
          if (at(1) !== c) break;
          i++;
        }
        value += at();
      }
      i++;
      tokens.push(
        c === "'"
          ? { kind: "string", value, start, end: i }
          : { kind: "word", text: value, quoted: true, start, end: i },
      );
    } else if (c === ":" && IDENT_START.test(at(1))) {
      for (i += 2; i < source.length && IDENT_PART.test(at()); i++);
      tokens.push({ kind: "param", name: source.slice(start + 1, i), start, end: i });
    } else if (c === "$" && DIGIT.test(at(1))) {
      for (i++; i < source.length && DIGIT.test(at()); i++);
      throw new SqlSyntaxError(
        `Use :name placeholders instead of ${source.slice(start, i)}; each placeholder is bound by name`,
        start,
        i,
      );
    } else if (DIGIT.test(c) || (c === "." && DIGIT.test(at(1)))) {
      digits();
      if (source.slice(start, i) === "0" && at() === "x") {
        for (i++; /[0-9a-fA-F]/.test(at()); i++);
        throw new SqlSyntaxError(
          "Hexadecimal literals are not supported by TailorDB SQL",
          start,
          i,
        );
      }
      if (at() === ".") {
        i++;
        digits();
      }
      const sign = /[+-]/.test(at(1)) ? 1 : 0;
      if (/[eE]/.test(at()) && DIGIT.test(at(1 + sign))) {
        i += 1 + sign;
        digits();
      }
      const text = source.slice(start, i);
      if (at() === "L") i++;
      tokens.push({ kind: "number", text, start, end: i });
    } else if (IDENT_START.test(c)) {
      for (i++; i < source.length && IDENT_PART.test(at()); i++);
      tokens.push({ kind: "word", text: source.slice(start, i), quoted: false, start, end: i });
    } else if ("(),;.[]+*/\\".includes(c)) {
      i++;
      push(start);
    } else if (c === ":") {
      i += at(1) === ":" ? 2 : 1;
      push(start);
    } else if (c === "=") {
      i += at(1) === ">" || at(1) === "=" ? 2 : 1;
      push(start);
    } else if (c === "!") {
      i += (["!~~*", "!~~", "!~*", "!~", "!=", "!!"].find((op) => source.startsWith(op, i)) ?? "!")
        .length;
      push(start);
    } else if (c === "<") {
      i++;
      if (at() === "=" && (at(1) === "+" || at(1) === "-")) {
        i++;
        push(start);
      } else if (at() === "+" || (at() === "-" && at(1) !== ">")) {
        push(start);
      } else {
        absorb(start);
      }
    } else if (OPERATOR_PART.test(c)) {
      i++;
      absorb(start);
    } else {
      throw new SqlSyntaxError(`Unexpected character ${JSON.stringify(c)}`, start, start + 1);
    }
  }
  tokens.push({ kind: "eof", start: source.length, end: source.length });
  return tokens;
}

function describeToken(token: Token): string {
  switch (token.kind) {
    case "eof":
      return "the end of the file";
    case "word":
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

  #span(start: number): SqlSpan {
    return { start, end: this.tokens[this.#index - 1]?.end ?? 0 };
  }

  #isKeyword(keyword: string, token: Token = this.#token): boolean {
    return token.kind === "word" && !token.quoted && token.text.toUpperCase() === keyword;
  }

  #isOp(text: string, token: Token = this.#token): boolean {
    return token.kind === "op" && token.text === text;
  }

  #isArithmeticOperator(): boolean {
    return ARITHMETIC_OPERATORS.some((op) => this.#isOp(op));
  }

  #acceptKeyword(keyword: string): boolean {
    if (!this.#isKeyword(keyword)) return false;
    this.#advance();
    return true;
  }

  // Accept the keywords in sequence, or none of them.
  #acceptKeywords(...keywords: string[]): boolean {
    if (!keywords.every((keyword, offset) => this.#isKeyword(keyword, this.#peek(offset)))) {
      return false;
    }
    for (const _keyword of keywords) this.#advance();
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
    if (token.kind === "op" && !(token.text in OPERATORS) && !"(),;.[]".includes(token.text)) {
      if (token.text === "::") this.#fail("Casts (::) are not supported by TailorDB SQL", token);
      const merged = /^(>=?|<>|<=?|~~?\*?|-)([+\-*/<>=~!@#%^&|`?].*)$/.exec(token.text);
      if (merged) {
        this.#fail(
          `TailorDB SQL reads "${token.text}" as one operator; put a space between "${merged[1]}" and "${merged[2]}"`,
          token,
        );
      }
      this.#fail(`Operator "${token.text}" is not supported by TailorDB SQL`, token);
    }
    if (this.#isKeyword("NULLS", token)) {
      this.#fail("NULLS FIRST and NULLS LAST are not supported by TailorDB SQL", token);
    }
    // A set operator after a table reads as its alias.
    const previous = this.tokens[this.#index - 1];
    for (const candidate of previous ? [token, previous] : [token]) {
      if (["UNION", "INTERSECT", "EXCEPT"].some((keyword) => this.#isKeyword(keyword, candidate))) {
        this.#fail(
          `${describeToken(candidate).toUpperCase()} is not supported by TailorDB SQL`,
          candidate,
        );
      }
    }
    this.#fail(`Unexpected ${describeToken(token)}; expected ${expected}`, token);
  }

  #expectKeyword(keyword: string): void {
    if (!this.#acceptKeyword(keyword)) this.#unexpected(keyword);
  }

  #expectOp(text: string): void {
    if (!this.#acceptOp(text)) this.#unexpected(`"${text}"`);
  }

  #identifier(expected: string): SqlIdentifier {
    const token = this.#token;
    if (token.kind !== "word") this.#unexpected(expected);
    this.#advance();
    return { name: token.text, quoted: token.quoted, span: { start: token.start, end: token.end } };
  }

  #commaSeparated<T>(item: () => T): T[] {
    const items: T[] = [];
    do items.push(item());
    while (this.#acceptOp(","));
    return items;
  }

  statement(): SqlStatement {
    while (this.#acceptOp(";"));
    if (this.#token.kind === "eof") throw new SqlSyntaxError("The file has no statement", 0, 0);
    let statement: SqlStatement;
    if (this.#isKeyword("SELECT")) statement = this.#select();
    else if (this.#isKeyword("INSERT")) statement = this.#insert();
    else if (this.#isKeyword("UPDATE")) statement = this.#update();
    else if (this.#isKeyword("DELETE")) statement = this.#delete();
    else if (this.#isKeyword("WITH")) this.#fail("WITH is not supported by TailorDB SQL");
    else if (["BEGIN", "START", "COMMIT", "ROLLBACK"].some((k) => this.#isKeyword(k))) {
      this.#fail(
        "Transaction statements are not supported in a .sql file; run the query on a transaction instead",
      );
    } else this.#unexpected("SELECT, INSERT, UPDATE or DELETE");
    let separated = false;
    while (this.#acceptOp(";")) separated = true;
    if (this.#peek(0).kind === "eof") return statement;
    if (separated) this.#fail("A .sql file must contain one statement");
    this.#unexpected("the end of the statement");
  }

  #select(): SqlSelect {
    const start = this.#token.start;
    this.#expectKeyword("SELECT");
    const items = this.#commaSeparated(() => this.#selectItem());
    if (!this.#isKeyword("FROM")) this.#afterSelectItems(items);
    this.#advance();
    const from = this.#tableRef();
    const joins: SqlJoin[] = [];
    for (let join = this.#join(); join; join = this.#join()) joins.push(join);
    if (this.#isOp(",")) this.#fail("Comma-separated tables are not supported; use JOIN");
    const where = this.#acceptKeyword("WHERE") ? this.#expression() : undefined;
    const groupBy = this.#acceptKeywords("GROUP", "BY")
      ? this.#commaSeparated(() => this.#columnRef("a column"))
      : [];
    const having = this.#acceptKeyword("HAVING") ? this.#expression() : undefined;
    const orderBy = this.#acceptKeywords("ORDER", "BY")
      ? this.#commaSeparated(() => this.#orderItem())
      : [];
    const limit = this.#acceptKeyword("LIMIT")
      ? this.#value("a number or a placeholder")
      : undefined;
    const offset = this.#acceptKeyword("OFFSET")
      ? this.#value("a number or a placeholder")
      : undefined;
    const locks: SqlSpan[] = [];
    while (this.#isKeyword("FOR")) locks.push(this.#lock());
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
      locks,
      span: this.#span(start),
    };
  }

  // Explain what follows the select list when it is not FROM.
  #afterSelectItems(items: SqlSelectItem[]): never {
    const [first] = items;
    const expr = first?.expr;
    if (
      items.length === 1 &&
      !first?.alias &&
      expr?.kind === "column" &&
      !expr.table &&
      !expr.column.quoted &&
      ["DISTINCT", "ALL"].includes(expr.column.name.toUpperCase())
    ) {
      this.#failAt(
        `SELECT ${expr.column.name.toUpperCase()} is not supported by TailorDB SQL`,
        expr.span,
      );
    }
    const token = this.#token;
    if (token.kind === "word" && !items.at(-1)?.alias) {
      this.#fail(`Write AS before the column alias ${describeToken(token)}; TailorDB SQL needs it`);
    }
    this.#unexpected("FROM");
  }

  #selectItem(): SqlSelectItem {
    const token = this.#token;
    const start = token.start;
    let expr: SqlSelectItem["expr"];
    if (this.#isAggregateStart()) {
      expr = this.#aggregate();
      if (this.#isArithmeticOperator()) this.#fail(STANDALONE_AGGREGATE);
    } else if (this.#acceptOp("*")) {
      expr = { kind: "star", span: this.#span(start) };
    } else if (
      token.kind === "word" &&
      this.#isOp(".", this.#peek()) &&
      this.#isOp("*", this.#peek(2))
    ) {
      const table = this.#identifier("a table");
      this.#advance();
      this.#advance();
      expr = { kind: "star", table, span: this.#span(start) };
    } else {
      expr = this.#scalar(STANDALONE_AGGREGATE);
    }
    const alias = this.#acceptKeyword("AS") ? this.#identifier("an alias") : undefined;
    return { expr, alias, span: this.#span(start) };
  }

  #isAggregateStart(): boolean {
    const token = this.#token;
    return (
      token.kind === "word" &&
      !token.quoted &&
      AGGREGATES.has(token.text.toUpperCase()) &&
      this.#isOp("(", this.#peek())
    );
  }

  #aggregate(): SqlAggregate {
    const nameToken = this.#advance();
    const fn = (
      nameToken.kind === "word" ? nameToken.text : ""
    ).toLowerCase() as SqlAggregateFunction;
    this.#expectOp("(");
    const distinct = this.#acceptKeyword("DISTINCT");
    let arg: SqlExpression | undefined;
    if (fn === "count" && this.#isOp("*")) {
      if (distinct) this.#fail("COUNT(DISTINCT *) is not supported by TailorDB SQL");
      this.#advance();
    } else {
      arg = this.#scalar("Aggregates cannot be nested");
    }
    this.#expectOp(")");
    return { kind: "aggregate", fn, distinct, arg, span: this.#span(nameToken.start) };
  }

  // The arithmetic of the select list, RETURNING and aggregate arguments; `nested` reports an
  // aggregate inside it.
  #scalar(nested: string): SqlExpression {
    let left = this.#scalarTerm(nested);
    while (this.#isOp("+") || this.#isOp("-")) {
      const op = this.#advance();
      left = this.#binary(op, left, this.#scalarTerm(nested));
    }
    return left;
  }

  #scalarTerm(nested: string): SqlExpression {
    let left = this.#scalarPrefix(nested);
    while (this.#isOp("*") || this.#isOp("/")) {
      const op = this.#advance();
      left = this.#binary(op, left, this.#scalarPrefix(nested));
    }
    return left;
  }

  #scalarPrefix(nested: string): SqlExpression {
    const token = this.#token;
    if (this.#isOp("+") || this.#isOp("-")) {
      this.#advance();
      const operand = this.#scalarPrefix(nested);
      return {
        kind: "unary",
        op: this.#isOp("+", token) ? "+" : "-",
        operand,
        span: this.#span(token.start),
      };
    }
    if (this.#isOp("(") && !this.#isKeyword("SELECT", this.#peek())) {
      this.#advance();
      const inner = this.#scalar(nested);
      this.#expectOp(")");
      return inner;
    }
    if (this.#isAggregateStart()) this.#fail(nested);
    return this.#primary("a column or a literal");
  }

  #binary(op: Token, left: SqlExpression, right: SqlExpression): SqlBinary {
    const text = op.kind === "op" ? op.text : op.kind === "word" ? op.text.toUpperCase() : "";
    return {
      kind: "binary",
      op: OPERATORS[text] ?? (text === "AND" ? "AND" : "OR"),
      left,
      right,
      span: { start: left.span.start, end: right.span.end },
    };
  }

  // A value, or else a column.
  #primary(expected: string): SqlExpression {
    return this.#startsValue() ? this.#value(expected) : this.#columnRef(expected);
  }

  #startsValue(): boolean {
    const token = this.#token;
    return (
      token.kind === "param" ||
      token.kind === "string" ||
      token.kind === "number" ||
      ["TRUE", "FALSE", "NULL"].some((keyword) => this.#isKeyword(keyword)) ||
      (this.#isKeyword("ARRAY") && this.#isOp("[", this.#peek())) ||
      (this.#isOp("(") && this.#isKeyword("SELECT", this.#peek()))
    );
  }

  #value(expected: string): SqlValue {
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
    if ((this.#isOp("-") || this.#isOp("+")) && this.#peek().kind === "number") {
      this.#advance();
      const number = this.#advance();
      const text = number.kind === "number" ? number.text : "";
      return {
        kind: "literal",
        type: "number",
        value: this.#isOp("-", token) ? `-${text}` : text,
        span: { start: token.start, end: number.end },
      };
    }
    if (this.#isKeyword("TRUE") || this.#isKeyword("FALSE")) {
      this.#advance();
      return {
        kind: "literal",
        type: "boolean",
        value: token.kind === "word" ? token.text.toLowerCase() : "",
        span,
      };
    }
    if (this.#isKeyword("NULL")) {
      this.#advance();
      return { kind: "literal", type: "null", value: "null", span };
    }
    if (this.#isKeyword("ARRAY") && this.#isOp("[", this.#peek())) {
      this.#advance();
      this.#advance();
      const items = this.#isOp("]") ? [] : this.#commaSeparated(() => this.#value("a value"));
      this.#expectOp("]");
      return { kind: "array", items, span: this.#span(token.start) };
    }
    if (this.#isOp("(") && this.#isKeyword("SELECT", this.#peek())) this.#subquery(this.#peek());
    this.#unexpected(expected);
  }

  #columnRef(expected: string): SqlColumnRef {
    const start = this.#token.start;
    if (this.#token.kind === "word" && this.#isOp("(", this.#peek())) this.#unsupportedFunction();
    if (!this.#isOp(".", this.#peek())) {
      return { kind: "column", column: this.#identifier(expected), span: this.#span(start) };
    }
    const table = this.#identifier(expected);
    this.#advance();
    const column = this.#identifier("a column");
    if (this.#isOp(".")) this.#fail("Schema-qualified names are not supported by TailorDB SQL");
    return { kind: "column", table, column, span: this.#span(start) };
  }

  #unsupportedFunction(): never {
    const token = this.#token;
    const name = token.kind === "word" ? token.text : "";
    if (this.#isKeyword("ANY") || this.#isKeyword("ALL") || this.#isKeyword("SOME")) {
      this.#fail(`${name.toUpperCase()} is not supported by TailorDB SQL; use IN`);
    }
    this.#fail(
      `Function "${name}" is not supported by TailorDB SQL; only COUNT, SUM, AVG, MIN and MAX are`,
    );
  }

  #subquery(token: Token): never {
    this.#fail("Subqueries are not supported by TailorDB SQL", token);
  }

  #tableRef(): SqlTableRef {
    const start = this.#token.start;
    if (this.#isOp("(") && this.#isKeyword("SELECT", this.#peek())) this.#subquery(this.#peek());
    const table = this.#identifier("a table");
    if (this.#isOp(".")) this.#fail("Schema-qualified names are not supported by TailorDB SQL");
    let alias: SqlIdentifier | undefined;
    if (this.#acceptKeyword("AS")) {
      alias = this.#identifier("an alias");
    } else if (
      this.#token.kind === "word" &&
      !TABLE_ALIAS_STOPS.some((keyword) => this.#isKeyword(keyword))
    ) {
      alias = this.#identifier("an alias");
    }
    return { table, alias, span: this.#span(start) };
  }

  #join(): SqlJoin | undefined {
    const start = this.#token.start;
    if (this.#acceptKeywords("CROSS", "JOIN")) {
      return { type: "cross", table: this.#tableRef(), span: this.#span(start) };
    }
    let type: SqlJoin["type"];
    if (this.#acceptKeyword("JOIN") || this.#acceptKeywords("INNER", "JOIN")) {
      type = "inner";
    } else if (this.#isKeyword("LEFT") || this.#isKeyword("RIGHT") || this.#isKeyword("FULL")) {
      const keyword = this.#advance();
      type = (keyword.kind === "word" ? keyword.text.toLowerCase() : "left") as SqlJoin["type"];
      this.#acceptKeyword("OUTER");
      this.#expectKeyword("JOIN");
    } else {
      return undefined;
    }
    const table = this.#tableRef();
    this.#expectKeyword("ON");
    const on = this.#expression();
    return { type, table, on, span: this.#span(start) };
  }

  #orderItem(): SqlOrderItem {
    const token = this.#token;
    let by: SqlOrderItem["by"];
    if (this.#isOp("(", this.#peek())) {
      if (token.kind !== "word" || token.text !== "vector_similarity") {
        if (token.kind === "word" && token.text.toLowerCase() === "vector_similarity") {
          this.#fail("Write vector_similarity in lowercase; TailorDB SQL matches it exactly");
        }
        this.#fail(
          "ORDER BY takes a column, a result column name, or vector_similarity(column, value)",
        );
      }
      this.#advance();
      this.#advance();
      const column = this.#columnRef("a column");
      this.#expectOp(",");
      const value = this.#value("a placeholder or a string");
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
    return { by, desc, span: this.#span(token.start) };
  }

  #lock(): SqlSpan {
    const start = this.#token.start;
    this.#advance();
    if (
      !this.#acceptKeywords("NO", "KEY", "UPDATE") &&
      !this.#acceptKeywords("KEY", "SHARE") &&
      !this.#acceptKeyword("SHARE") &&
      !this.#acceptKeyword("UPDATE")
    ) {
      this.#unexpected("UPDATE, NO KEY UPDATE, SHARE or KEY SHARE");
    }
    if (!this.#acceptKeyword("NOWAIT")) this.#acceptKeywords("SKIP", "LOCKED");
    return this.#span(start);
  }

  // A condition of WHERE, ON or HAVING, binding operators tighter than `precedence`.
  #expression(precedence = PRECEDENCE.lowest): SqlExpression {
    let left = this.#prefix();
    for (;;) {
      const next = this.#nextPrecedence();
      if (precedence >= next) return left;
      left = this.#infix(left, next);
    }
  }

  #prefix(): SqlExpression {
    const token = this.#token;
    if (this.#isOp("+") || this.#isOp("-")) {
      this.#advance();
      const operand = this.#expression(PRECEDENCE.unary);
      return {
        kind: "unary",
        op: this.#isOp("+", token) ? "+" : "-",
        operand,
        span: this.#span(token.start),
      };
    }
    if (this.#isOp("(") && !this.#isKeyword("SELECT", this.#peek())) {
      this.#advance();
      const inner = this.#expression();
      this.#expectOp(")");
      return inner;
    }
    if (this.#isKeyword("NOT")) {
      this.#advance();
      const operand = this.#expression(PRECEDENCE.not);
      return { kind: "unary", op: "NOT", operand, span: this.#span(token.start) };
    }
    if (this.#isAggregateStart()) return this.#aggregate();
    if (
      token.kind === "word" ||
      token.kind === "number" ||
      token.kind === "string" ||
      token.kind === "param" ||
      this.#isOp("(")
    ) {
      return this.#primary("a column, a literal or a placeholder");
    }
    this.#unexpected("an expression");
  }

  #nextPrecedence(): number {
    const token = this.#token;
    if (token.kind === "op") return OPERATOR_PRECEDENCE[token.text] ?? PRECEDENCE.lowest;
    if (this.#isKeyword("AND")) return PRECEDENCE.and;
    if (this.#isKeyword("OR")) return PRECEDENCE.or;
    if (this.#isKeyword("IS")) return PRECEDENCE.is;
    const operator = this.#isKeyword("NOT") ? this.#peek() : token;
    return ["LIKE", "ILIKE", "BETWEEN", "IN"].some((keyword) => this.#isKeyword(keyword, operator))
      ? PRECEDENCE.pattern
      : PRECEDENCE.lowest;
  }

  #infix(left: SqlExpression, precedence: number): SqlExpression {
    const token = this.#token;
    const start = left.span.start;
    if (token.kind === "op" || this.#isKeyword("AND") || this.#isKeyword("OR")) {
      this.#advance();
      return this.#binary(token, left, this.#expression(precedence));
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
      const items = this.#commaSeparated(() => this.#expression());
      this.#expectOp(")");
      return { kind: "in", not, left, items, span: this.#span(start) };
    }
    if (this.#acceptKeyword("BETWEEN")) {
      const low = this.#expression(PRECEDENCE.pattern);
      this.#expectKeyword("AND");
      const high = this.#expression(PRECEDENCE.pattern);
      return { kind: "between", not, left, low, high, span: this.#span(start) };
    }
    const keyword = this.#isKeyword("ILIKE") ? "ILIKE" : "LIKE";
    this.#advance();
    const right = this.#expression(precedence);
    return {
      kind: "binary",
      op: not ? `NOT ${keyword}` : keyword,
      left,
      right,
      span: { start, end: right.span.end },
    };
  }

  #insert(): SqlInsert {
    const start = this.#token.start;
    this.#expectKeyword("INSERT");
    this.#expectKeyword("INTO");
    const table = this.#identifier("a table");
    let columns: SqlIdentifier[] = [];
    let rows: SqlInsert["rows"];
    if (this.#acceptKeywords("DEFAULT", "VALUES")) {
      rows = "default";
    } else {
      this.#expectOp("(");
      columns = this.#commaSeparated(() => this.#identifier("a column"));
      this.#expectOp(")");
      this.#expectKeyword("VALUES");
      rows = this.#commaSeparated(() => {
        const rowStart = this.#token.start;
        this.#expectOp("(");
        const values = this.#commaSeparated((): SqlValue | SqlDefault => {
          const token = this.#token;
          if (this.#acceptKeyword("DEFAULT")) {
            return { kind: "default", span: { start: token.start, end: token.end } };
          }
          return this.#value("a literal, a placeholder or DEFAULT");
        });
        this.#expectOp(")");
        return { values, span: this.#span(rowStart) };
      });
    }
    let onConflict: SqlInsert["onConflict"];
    if (this.#acceptKeywords("ON", "CONFLICT")) {
      this.#expectOp("(");
      const column = this.#identifier("a column");
      if (this.#isOp(",")) this.#fail("ON CONFLICT takes a single column in TailorDB SQL");
      this.#expectOp(")");
      this.#expectKeyword("DO");
      if (this.#acceptKeyword("NOTHING")) {
        onConflict = { column, action: { kind: "nothing" } };
      } else if (this.#acceptKeyword("UPDATE")) {
        this.#expectKeyword("SET");
        const sets = this.#commaSeparated(() => {
          const setStart = this.#token.start;
          const target = this.#identifier("a column");
          this.#expectOp("=");
          return { column: target, value: this.#conflictValue(), span: this.#span(setStart) };
        });
        if (this.#isKeyword("WHERE")) {
          this.#fail("WHERE after ON CONFLICT DO UPDATE is not supported by TailorDB SQL");
        }
        onConflict = { column, action: { kind: "update", sets } };
      } else {
        this.#unexpected("NOTHING or UPDATE");
      }
    }
    const returning = this.#returning();
    return { kind: "insert", table, columns, rows, onConflict, returning, span: this.#span(start) };
  }

  #conflictValue(): SqlValue | SqlExcluded {
    const token = this.#token;
    if (
      token.kind === "word" &&
      (token.quoted ? token.text === "excluded" : token.text.toLowerCase() === "excluded")
    ) {
      this.#advance();
      this.#expectOp(".");
      const column = this.#identifier("a column");
      return { kind: "excluded", column, span: this.#span(token.start) };
    }
    return this.#value("a literal, a placeholder or EXCLUDED.column");
  }

  #update(): SqlUpdate {
    const start = this.#token.start;
    this.#expectKeyword("UPDATE");
    const table = this.#identifier("a table");
    this.#expectKeyword("SET");
    const sets = this.#commaSeparated(() => {
      const setStart = this.#token.start;
      const column = this.#identifier("a column");
      this.#expectOp("=");
      const left = this.#setOperand();
      const opToken = this.#token;
      if (!this.#isArithmeticOperator()) {
        return { column, value: left, span: this.#span(setStart) };
      }
      this.#advance();
      const right = this.#setOperand();
      const value: SqlSetArithmetic = {
        kind: "arithmetic",
        op: (opToken.kind === "op" ? opToken.text : "+") as SqlArithmeticOperator,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
      return { column, value, span: this.#span(setStart) };
    });
    const where = this.#acceptKeyword("WHERE") ? this.#expression() : undefined;
    const returning = this.#returning();
    return { kind: "update", table, sets, where, returning, span: this.#span(start) };
  }

  #setOperand(): SqlSetOperand {
    const signed = (this.#isOp("-") || this.#isOp("+")) && this.#peek().kind === "number";
    return signed || this.#startsValue()
      ? this.#value("a column, a literal or a placeholder")
      : this.#columnRef("a column, a literal or a placeholder");
  }

  #delete(): SqlDelete {
    const start = this.#token.start;
    this.#expectKeyword("DELETE");
    this.#expectKeyword("FROM");
    const table = this.#identifier("a table");
    const where = this.#acceptKeyword("WHERE") ? this.#expression() : undefined;
    const returning = this.#returning();
    return { kind: "delete", table, where, returning, span: this.#span(start) };
  }

  #returning(): SqlSelectItem[] | undefined {
    return this.#acceptKeyword("RETURNING")
      ? this.#commaSeparated(() => this.#selectItem())
      : undefined;
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
