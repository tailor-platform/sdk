import { describe, expect, test } from "vitest";
import { isSqlInputComplete } from "./sql-repl";

describe("isSqlInputComplete", () => {
  test("returns true when the last statement ends with a semicolon", () => {
    expect(isSqlInputComplete('select * from "User";')).toBe(true);
  });

  test("accepts trailing line comments after the terminator", () => {
    expect(isSqlInputComplete('select * from "User"; -- inspect')).toBe(true);
  });

  test("ignores semicolons inside string literals", () => {
    expect(isSqlInputComplete("insert into t values ('hello;world')")).toBe(false);
    expect(isSqlInputComplete("insert into t values ('hello;world');")).toBe(true);
  });

  test("accepts trailing block comments after the terminator", () => {
    expect(isSqlInputComplete('select * from "User"; /* inspect */')).toBe(true);
  });

  test("returns false for incomplete quoted input", () => {
    expect(isSqlInputComplete("select 'unterminated")).toBe(false);
  });

  test("supports dollar-quoted strings", () => {
    expect(isSqlInputComplete("select $$hello;world$$;")).toBe(true);
  });

  test("returns false when a quoted token appears after a semicolon", () => {
    expect(isSqlInputComplete("select 1; 'hello'")).toBe(false);
    expect(isSqlInputComplete('select 1; "User"')).toBe(false);
    expect(isSqlInputComplete("select 1; $$hello$$")).toBe(false);
  });
});
