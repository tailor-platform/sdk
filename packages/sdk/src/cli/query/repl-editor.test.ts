import { describe, expect, test } from "vitest";
import { stripAnsi } from "../shared/test-helpers/strip-ansi";
import { highlightGraphqlLines, highlightSqlLines, replTransform } from "./repl-editor";
import type { TransformEvent, TransformState } from "@toiroakr/read-multiline";

const highlightSqlLine = (line: string) => highlightSqlLines([line])[0] ?? "";
const highlightGraphqlLine = (line: string) => highlightGraphqlLines([line])[0] ?? "";

describe("highlightSqlLines", () => {
  test("wraps SQL keywords in ANSI colour", () => {
    const out = highlightSqlLine("SELECT * FROM users WHERE id = 1");
    expect(out).not.toBe("SELECT * FROM users WHERE id = 1");
    expect(out).toContain("\x1b[34mSELECT\x1b[0m");
    expect(out).toContain("\x1b[34mFROM\x1b[0m");
    expect(out).toContain("\x1b[34mWHERE\x1b[0m");
    expect(stripAnsi(out)).toBe("SELECT * FROM users WHERE id = 1");
  });

  test("colours identifiers and numbers distinctly from keywords", () => {
    const out = highlightSqlLine("SELECT id FROM users");
    expect(out).toContain("\x1b[33mid\x1b[0m");
    expect(out).toContain("\x1b[33musers\x1b[0m");
  });

  test("leaves unrelated text intact", () => {
    const out = highlightSqlLine("");
    expect(out).toBe("");
  });
});

describe("highlightSqlLines (multi-line)", () => {
  test("dims every line of a block comment spanning lines", () => {
    const out = highlightSqlLines(["SELECT 1 /* a", "b", " c */ AND 2"]);
    expect(out[0]).toContain("\x1b[90m/* a\x1b[0m");
    expect(out[1]).toBe("\x1b[90mb\x1b[0m");
    expect(out[2]).toContain("\x1b[90m c */\x1b[0m");
    expect(out[2]).toContain("\x1b[36m2\x1b[0m");
  });

  test("dims a -- line comment", () => {
    expect(highlightSqlLine("SELECT 1 -- note")).toContain("\x1b[90m-- note\x1b[0m");
  });

  test("does not open a block comment from /* inside a string literal", () => {
    const out = highlightSqlLines(["SELECT '/*'", "FROM users"]);
    expect(out[1]).toContain("\x1b[34mFROM\x1b[0m");
  });

  test("does not open a block comment from /* inside a -- comment", () => {
    const out = highlightSqlLines(["SELECT 1 -- /*", "FROM users"]);
    expect(out[1]).toContain("\x1b[34mFROM\x1b[0m");
  });

  test("keeps a nested block comment open until every level is closed", () => {
    const out = highlightSqlLines(["/* a /* b */", "c */ SELECT 1"]);
    expect(out[1]).toContain("\x1b[90mc */\x1b[0m");
    expect(out[1]).toContain("\x1b[34mSELECT\x1b[0m");
  });

  test("keeps the line count and text", () => {
    const lines = ["SELECT 1 /* a", "b */ 'x'", "FROM t"];
    expect(highlightSqlLines(lines).map(stripAnsi)).toEqual(lines);
  });
});

describe("highlightGraphqlLines (multi-line)", () => {
  test("colours every line of a block string spanning lines", () => {
    const out = highlightGraphqlLines(['a(s: """doc', "mid", 'more""") { b }']);
    expect(out[0]).toContain('\x1b[32m"""doc\x1b[0m');
    expect(out[1]).toBe("\x1b[32mmid\x1b[0m");
    expect(out[2]).toContain('\x1b[32mmore"""\x1b[0m');
    expect(out[2]).toContain("\x1b[94mb\x1b[0m");
  });

  test('does not open a block string from """ inside a comment', () => {
    const out = highlightGraphqlLines(['# """', "query Q { a }"]);
    expect(out[1]).toContain("\x1b[34mquery\x1b[0m");
  });

  test('does not open a block string from """ inside a regular string', () => {
    const out = highlightGraphqlLines([String.raw`a(s: "x\"\"\"")`, "query Q { a }"]);
    expect(out[1]).toContain("\x1b[34mquery\x1b[0m");
  });

  test("keeps the line count and text", () => {
    const lines = ['a(s: """doc', "mid", 'more""")'];
    expect(highlightGraphqlLines(lines).map(stripAnsi)).toEqual(lines);
  });
});

describe("highlightGraphqlLines", () => {
  test("dims GraphQL comment lines", () => {
    const out = highlightGraphqlLine("# this is a comment");
    expect(out).toBe("\x1b[90m# this is a comment\x1b[0m");
  });

  test("colours keyword, operation name and field name separately", () => {
    const out = highlightGraphqlLine("query Q { name }");
    expect(out).toContain("\x1b[34mquery\x1b[0m");
    expect(out).toContain("\x1b[1;36mQ\x1b[0m");
    expect(out).toContain("\x1b[94mname\x1b[0m");
    expect(stripAnsi(out)).toBe("query Q { name }");
  });

  test("distinguishes argument names, variables and types", () => {
    const out = highlightGraphqlLine("user(id: ID!, active: $flag)");
    expect(out).toContain("\x1b[3;33mid\x1b[0m");
    expect(out).toContain("\x1b[36mID\x1b[0m");
    expect(out).toContain("\x1b[35m$\x1b[0m");
    expect(out).toContain("\x1b[35mflag\x1b[0m");
  });

  test("styles braces and parentheses", () => {
    const out = highlightGraphqlLine("{ user(id: 1) }");
    expect(out).toContain("\x1b[33m{\x1b[0m");
    expect(out).toContain("\x1b[33m}\x1b[0m");
    expect(out).toContain("\x1b[2;33m(\x1b[0m");
    expect(out).toContain("\x1b[2;33m)\x1b[0m");
  });

  test("returns the line as-is when the lexer rejects the input", () => {
    const input = "@@@ invalid @@@";
    expect(stripAnsi(highlightGraphqlLine(input))).toBe(input);
  });
});

function insertEvent(char: string): TransformEvent {
  return { type: "insert", char };
}

describe("replTransform", () => {
  test("auto-closes an opening bracket and keeps cursor between the pair", () => {
    const state: TransformState = { lines: ["("], row: 0, col: 1 };
    const result = replTransform(state, insertEvent("("));
    expect(result).toEqual({ lines: ["()"], row: 0, col: 1 });
  });

  test("auto-closes curly and square brackets", () => {
    expect(replTransform({ lines: ["{"], row: 0, col: 1 }, insertEvent("{"))).toEqual({
      lines: ["{}"],
      row: 0,
      col: 1,
    });
    expect(replTransform({ lines: ["["], row: 0, col: 1 }, insertEvent("["))).toEqual({
      lines: ["[]"],
      row: 0,
      col: 1,
    });
  });

  test("skips over a matching closing bracket that was auto-inserted", () => {
    const state: TransformState = { lines: ["())"], row: 0, col: 2 };
    const result = replTransform(state, insertEvent(")"));
    expect(result).toEqual({ lines: ["()"], row: 0, col: 2 });
  });

  test("dedents by one space when backspacing on an indent-only prefix", () => {
    const state: TransformState = { lines: ["    "], row: 0, col: 4 };
    const result = replTransform(state, { type: "backspace" });
    expect(result).toEqual({ lines: ["   "], row: 0, col: 3 });
  });

  test("adds an extra indent level after a line that ends with an open bracket", () => {
    const state: TransformState = { lines: ["query {", ""], row: 1, col: 0 };
    const result = replTransform(state, { type: "newline" });
    expect(result).toEqual({
      lines: ["query {", "  ", "}"],
      row: 1,
      col: 2,
    });
  });

  test("performs bracket expansion when cursor sits between an open and close bracket", () => {
    const state: TransformState = { lines: ["query {", "}"], row: 1, col: 0 };
    const result = replTransform(state, { type: "newline" });
    expect(result).toEqual({
      lines: ["query {", "  ", "}"],
      row: 1,
      col: 2,
    });
  });

  test("preserves existing indentation on a plain newline", () => {
    const state: TransformState = { lines: ["  foo", ""], row: 1, col: 0 };
    const result = replTransform(state, { type: "newline" });
    expect(result).toEqual({ lines: ["  foo", "  "], row: 1, col: 2 });
  });

  test("returns undefined for unrelated events", () => {
    const state: TransformState = { lines: ["abc"], row: 0, col: 3 };
    expect(replTransform(state, insertEvent("a"))).toBeUndefined();
  });
});
