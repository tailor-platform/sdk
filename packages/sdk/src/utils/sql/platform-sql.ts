/**
 * TailorDB's SQL parser and analyzer, built to WebAssembly, which read a `.sql` file written with
 * `:name` placeholders and return its syntax tree, or what the statement takes and returns, as
 * JSON.
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

/** A field as TailorDB's analyzer typed a result column or a placeholder. */
export interface PlatformField {
  /** The table the field belongs to, or empty for one the analyzer derived. */
  table: string;
  name: string;
  type: string;
  required: boolean;
  array: boolean;
  allowedValues: string[] | null;
  fields: Record<string, PlatformField> | null;
}

/** What a statement returns and takes as TailorDB's analyzer sees it, or why it rejects it. */
export type PlatformAnalyzeResult =
  | {
      ok: true;
      /** The result columns, with `*` expanded in an order of TailorDB's choosing. */
      columns: { name: string; schema: PlatformField }[];
      /** The field each `$n` is bound to, by `n`. */
      params: { index: number; schema: PlatformField }[];
    }
  | { ok: false; message: string; start: number; end: number };

interface PlatformExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  parse(pointer: number, length: number): number;
  analyze(pointer: number, length: number, schemaPointer: number, schemaLength: number): number;
}

/** TailorDB's SQL parser and analyzer. */
export interface PlatformSql {
  parse(source: string): PlatformParseResult;
  analyze(source: string, schema: string): PlatformAnalyzeResult;
}

const STOPPED =
  "TailorDB's SQL check stopped on this query; it may be nested too deeply, so split it into simpler conditions";

/**
 * Load the parser and analyzer from a `.wasm` file.
 * @param wasmPath - The file to load
 * @returns Functions that parse and analyze one `.sql` source
 */
export function createPlatformSql(wasmPath: string): PlatformSql {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = readFileSync(wasmPath);
  } catch (error) {
    throw new Error(`TailorDB's SQL parser and analyzer are missing: ${wasmPath}`, {
      cause: error,
    });
  }
  const module = new WebAssembly.Module(bytes);
  const instantiate = () =>
    new WebAssembly.Instance(module, {}).exports as unknown as PlatformExports;
  let exports = instantiate();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // Run an export on UTF-8 copies of `inputs`, or return undefined when the module traps.
  const call = (inputs: string[], run: (...pointers: number[]) => number): string | undefined => {
    try {
      const allocated = inputs.map((input) => {
        const encoded = encoder.encode(input);
        const pointer = exports.alloc(encoded.length);
        new Uint8Array(exports.memory.buffer, pointer, encoded.length).set(encoded);
        return { pointer, length: encoded.length };
      });
      const output = run(...allocated.flatMap(({ pointer, length }) => [pointer, length]));
      for (const { pointer, length } of allocated) exports.dealloc(pointer, length);
      const length = new DataView(exports.memory.buffer).getUint32(output, true);
      const json = decoder.decode(new Uint8Array(exports.memory.buffer, output + 4, length));
      exports.dealloc(output, 4 + length);
      return json;
    } catch (error) {
      if (!(error instanceof WebAssembly.RuntimeError || error instanceof RangeError)) throw error;
      // A trap leaves the instance unusable.
      exports = instantiate();
      return undefined;
    }
  };
  return {
    parse(source) {
      const json = call([source], (pointer, length) => exports.parse(pointer, length));
      if (json === undefined) return { ok: false, message: STOPPED, start: 0, end: 0 };
      return JSON.parse(json) as PlatformParseResult;
    },
    analyze(source, schema) {
      const json = call([source, schema], (pointer, length, schemaPointer, schemaLength) =>
        exports.analyze(pointer, length, schemaPointer, schemaLength),
      );
      if (json === undefined) return { ok: false, message: STOPPED, start: 0, end: 0 };
      const result = JSON.parse(json) as PlatformAnalyzeResult | { invalidSchema: string };
      if ("invalidSchema" in result) {
        throw new Error(
          `TailorDB's SQL analyzer cannot read the schema of the namespace: ${result.invalidSchema}`,
        );
      }
      return result;
    },
  };
}

let platformSql: PlatformSql | undefined;

// The module in this package's `wasm` directory, loaded on first use.
function loadPlatformSql(): PlatformSql {
  if (!platformSql) {
    const packageJson = findUpSync("package.json", {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
    });
    if (!packageJson) {
      throw new Error("Cannot find the package of TailorDB's SQL parser and analyzer");
    }
    platformSql = createPlatformSql(path.join(path.dirname(packageJson), "wasm", "sqlaccess.wasm"));
  }
  return platformSql;
}

/**
 * Parse a `.sql` source with TailorDB's parser.
 * @param source - The content of a `.sql` file
 * @returns The statement, or why it does not parse
 */
export function parseWithPlatform(source: string): PlatformParseResult {
  return loadPlatformSql().parse(source);
}

/**
 * Analyze a `.sql` source with TailorDB's analyzer, against the types of one namespace.
 * @param source - The content of a `.sql` file
 * @param schema - TailorDB's JSON of each type of the namespace, keyed by type name
 * @returns What the statement returns and takes, or why TailorDB rejects it
 */
export function analyzeWithPlatform(source: string, schema: string): PlatformAnalyzeResult {
  return loadPlatformSql().analyze(source, schema);
}
