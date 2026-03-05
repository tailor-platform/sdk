import { describe, expect, test } from "vitest";
import { extractTypeNamesFromSql, hasWildcardSelect } from "./sql-type-extractor";

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

describe("hasWildcardSelect", () => {
  test("returns true for SELECT *", () => {
    expect(hasWildcardSelect('select * from "User"')).toBe(true);
  });

  test("returns true for SELECT * with JOIN", () => {
    expect(hasWildcardSelect('select * from "User" u join "Order" o on u.id = o.userId')).toBe(
      true,
    );
  });

  test("returns false for explicit column list", () => {
    expect(hasWildcardSelect('select id, name from "User"')).toBe(false);
  });

  test("returns false for unparseable query", () => {
    expect(hasWildcardSelect("select from")).toBe(false);
  });

  test("returns true for subquery with wildcard", () => {
    expect(hasWildcardSelect('select * from (select * from "User") u')).toBe(true);
  });

  test("returns false for COUNT(*)", () => {
    expect(hasWildcardSelect('select count(*) from "User"')).toBe(false);
  });
});
