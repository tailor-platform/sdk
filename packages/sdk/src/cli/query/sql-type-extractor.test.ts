import { describe, expect, test } from "vitest";
import { extractTypeNamesFromSql } from "./sql-type-extractor";

describe("extractTypeNamesFromSql", () => {
  test("extracts table names using SQL parser", () => {
    const sql = `select * from "User" u join "Order" o on u.id = o.userId`;

    expect(extractTypeNamesFromSql(sql)).toEqual(["User", "Order"]);
  });

  test("ignores CTE alias names", () => {
    const sql = `with tmp as (select * from "User") select * from tmp join "Order" o on tmp.id = o.userId`;

    expect(extractTypeNamesFromSql(sql)).toEqual(["User", "Order"]);
  });

  test("throws when parser cannot parse query", () => {
    const sql = "select from";

    expect(() => extractTypeNamesFromSql(sql)).toThrowError();
  });

  test("does not throw for parseable non-DML statements", () => {
    const sql = "create table t (id integer)";

    expect(() => extractTypeNamesFromSql(sql)).not.toThrow();
  });
});
