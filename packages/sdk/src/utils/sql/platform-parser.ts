/**
 * TailorDB's SQL parser, built to WebAssembly, which reads a `.sql` file written with `:name`
 * placeholders and returns its syntax tree as JSON.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";

/** A range of the original source, in UTF-16 code units. */
export interface PlatformSpan {
  start: number;
  end: number;
}

export interface PlatformIdent {
  value: string;
  span: PlatformSpan;
}

export interface PlatformColumn {
  table: PlatformIdent | null;
  column: PlatformIdent;
}

export interface PlatformValue {
  kind:
    | { String: string }
    | { Number: string }
    | { Boolean: boolean }
    | { Array: PlatformValue[] }
    | "Null"
    | { Placeholder: number };
  span: PlatformSpan;
}

interface PlatformAggregateArgument {
  distinct: boolean;
  expr: PlatformScalarExpr;
}

export interface PlatformAggregate {
  kind:
    | { Count: "Wildcard" | { Column: PlatformAggregateArgument } }
    | { Sum: PlatformAggregateArgument }
    | { Avg: PlatformAggregateArgument }
    | { Max: PlatformAggregateArgument }
    | { Min: PlatformAggregateArgument };
  span: PlatformSpan;
}

export type PlatformArithmeticOp = "Add" | "Subtract" | "Multiply" | "Divide";

export type PlatformScalarExpr =
  | { Column: PlatformColumn }
  | { Value: PlatformValue }
  | { UnaryOp: { op: "Plus" | "Minus"; expr: PlatformScalarExpr; span: PlatformSpan } }
  | { BinaryOp: { left: PlatformScalarExpr; op: PlatformArithmeticOp; right: PlatformScalarExpr } };

export type PlatformBinaryOp =
  | PlatformArithmeticOp
  | "Eq"
  | "NotEq"
  | "Gt"
  | "GtEq"
  | "Lt"
  | "LtEq"
  | "Like"
  | "NotLike"
  | "ILike"
  | "NotILike"
  | "Regexp"
  | "NotRegexp"
  | "IRegexp"
  | "NotIRegexp"
  | "And"
  | "Or";

export type PlatformExpr =
  | { Column: PlatformColumn }
  | { Value: PlatformValue }
  | { UnaryOp: { op: "Plus" | "Minus" | "Not"; expr: PlatformExpr; span: PlatformSpan } }
  | { BinaryOp: { left: PlatformExpr; op: PlatformBinaryOp; right: PlatformExpr } }
  | { In: { left: PlatformExpr; values: PlatformExpr[]; negated: boolean; span: PlatformSpan } }
  | { Between: { left: PlatformExpr; low: PlatformExpr; high: PlatformExpr; negated: boolean } }
  | { IsNull: { left: PlatformExpr; negated: boolean; span: PlatformSpan } }
  | { AggregateFunction: PlatformAggregate };

export type PlatformSelectItem =
  | { Column: { column: PlatformColumn; alias: PlatformIdent | null } }
  | { Wildcard: { table: PlatformIdent | null; span: PlatformSpan } }
  | { AggregateFunction: { function: PlatformAggregate; alias: PlatformIdent | null } }
  | { Expression: { expr: PlatformScalarExpr; alias: PlatformIdent | null } };

export interface PlatformTable {
  name: PlatformIdent;
  alias: PlatformIdent | null;
}

export interface PlatformJoin {
  table: PlatformTable;
  action:
    | { Inner: PlatformExpr }
    | { Left: PlatformExpr }
    | { Right: PlatformExpr }
    | { Full: PlatformExpr }
    | "Cross";
}

export interface PlatformOrderBy {
  target:
    | { Column: PlatformColumn }
    | { Vector: { column: PlatformColumn; value: PlatformValue; span: PlatformSpan } };
  direction: "Asc" | "Desc";
}

export type PlatformColumnOrValue = { Column: PlatformColumn } | { Value: PlatformValue };

interface PlatformSelect {
  select_items: PlatformSelectItem[];
  from: { table: PlatformTable; joins: PlatformJoin[] };
  where_expr: PlatformExpr | null;
  group_by: PlatformColumn[] | null;
  having: PlatformExpr | null;
  order_by: PlatformOrderBy[] | null;
  limit: PlatformValue | null;
  offset: PlatformValue | null;
  locks: { span: PlatformSpan }[];
}

interface PlatformInsert {
  table: PlatformTable;
  columns: PlatformColumn[];
  values: { values: ({ Value: PlatformValue } | "Default")[]; span: PlatformSpan }[];
  on_conflict: {
    target: PlatformColumn;
    action:
      | "Nothing"
      | {
          Update: {
            column: PlatformColumn;
            value: PlatformColumnOrValue;
            value_span: PlatformSpan;
          }[];
        };
  } | null;
  returning: PlatformSelectItem[];
}

interface PlatformUpdate {
  table: PlatformTable;
  assignments: {
    column: PlatformColumn;
    left_value: PlatformColumnOrValue;
    arithmetic_op: PlatformArithmeticOp | null;
    right_value: PlatformColumnOrValue | null;
  }[];
  where_expr: PlatformExpr | null;
  returning: PlatformSelectItem[];
}

interface PlatformDelete {
  table: PlatformTable;
  where_expr: PlatformExpr | null;
  returning: PlatformSelectItem[];
}

export type PlatformStatement =
  | { Select: PlatformSelect }
  | { Insert: PlatformInsert }
  | { Update: PlatformUpdate }
  | { Delete: PlatformDelete }
  | { StartTransaction: unknown }
  | "CommitTransaction"
  | "RollbackTransaction";

/** The statement of a `.sql` file and the text sent to TailorDB, or why it does not parse. */
export type PlatformParseResult =
  | {
      ok: true;
      /** The statement as sent: from its first token to its last, each `:name` replaced by `$n`. */
      text: string;
      /** The placeholder name each `$n` of `text` binds, in order. */
      paramNames: string[];
      span: PlatformSpan;
      statement: PlatformStatement;
    }
  | { ok: false; message: string; start: number; end: number };

interface ParserExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  parse(pointer: number, length: number): number;
}

const STOPPED =
  "The SQL parser stopped on this query; it may be nested too deeply, so split it into simpler conditions";

/**
 * Load the parser from a `.wasm` file.
 * @param wasmPath - The file to load
 * @returns A function that parses one `.sql` source
 */
export function createPlatformParser(wasmPath: string): (source: string) => PlatformParseResult {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = readFileSync(wasmPath);
  } catch (error) {
    throw new Error(`The SQL parser is missing: ${wasmPath}`, { cause: error });
  }
  const module = new WebAssembly.Module(bytes);
  const instantiate = () =>
    new WebAssembly.Instance(module, {}).exports as unknown as ParserExports;
  let parser = instantiate();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (source) => {
    const input = encoder.encode(source);
    let json: string;
    try {
      const pointer = parser.alloc(input.length);
      new Uint8Array(parser.memory.buffer, pointer, input.length).set(input);
      const output = parser.parse(pointer, input.length);
      parser.dealloc(pointer, input.length);
      const length = new DataView(parser.memory.buffer).getUint32(output, true);
      json = decoder.decode(new Uint8Array(parser.memory.buffer, output + 4, length));
      parser.dealloc(output, 4 + length);
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError || error instanceof RangeError)) throw error;
      // A trap leaves the instance unusable.
      parser = instantiate();
      return { ok: false, message: STOPPED, start: 0, end: 0 };
    }
    return JSON.parse(json) as PlatformParseResult;
  };
}

let parsePlatformSql: ((source: string) => PlatformParseResult) | undefined;

/**
 * Parse a `.sql` source with the parser shipped in this package's `wasm` directory, loaded on
 * first use.
 * @param source - The content of a `.sql` file
 * @returns The statement, or why it does not parse
 */
export function parseWithPlatformParser(source: string): PlatformParseResult {
  if (!parsePlatformSql) {
    const packageJson = findUpSync("package.json", {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
    });
    if (!packageJson) throw new Error("Cannot find the package of the SQL parser");
    parsePlatformSql = createPlatformParser(
      path.join(path.dirname(packageJson), "wasm", "sqlaccess_parser.wasm"),
    );
  }
  return parsePlatformSql(source);
}
