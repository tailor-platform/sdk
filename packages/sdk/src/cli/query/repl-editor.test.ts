import { describe, expect, test } from "vitest";
import { stripAnsi } from "../shared/test-helpers/strip-ansi";
import { highlightGraphqlLines, highlightSqlLines, replTransform } from "./repl-editor";
import type { TransformEvent, TransformState } from "@toiroakr/read-multiline";

describe("highlightSqlLines", () => {
  test("applies the ANSI theme without changing the text", () => {
    const lines = ["SELECT id FROM users", "WHERE id = 1"];
    const out = highlightSqlLines(lines);
    expect(out).not.toEqual(lines);
    expect(out.map(stripAnsi)).toEqual(lines);
  });
});

describe("highlightGraphqlLines", () => {
  test("applies the ANSI theme without changing the text", () => {
    const lines = ["query Q {", "  user(id: 1) { name }", "}"];
    const out = highlightGraphqlLines(lines);
    expect(out).not.toEqual(lines);
    expect(out.map(stripAnsi)).toEqual(lines);
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
