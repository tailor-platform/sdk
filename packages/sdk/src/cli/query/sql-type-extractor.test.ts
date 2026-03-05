import { describe, expect, test } from "vitest";
import { extractTypeNamesFromSql, extractWildcardTypeNames } from "./sql-type-extractor";

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

describe("extractWildcardTypeNames", () => {
  test("returns type name for SELECT *", () => {
    expect(extractWildcardTypeNames('select * from "User"')).toEqual(["User"]);
  });

  test("returns all type names for SELECT * with JOIN", () => {
    expect(
      extractWildcardTypeNames('select * from "User" u join "Order" o on u.id = o."userId"'),
    ).toEqual(["User", "Order"]);
  });

  test("returns type name for qualified wildcard (u.*)", () => {
    expect(extractWildcardTypeNames('select u.* from "User" as u')).toEqual(["User"]);
  });

  test("returns only wildcard table for qualified wildcard in JOIN", () => {
    expect(
      extractWildcardTypeNames('select u.* from "User" u join "Order" o on u.id = o."userId"'),
    ).toEqual(["User"]);
  });

  test("returns multiple types for multiple qualified wildcards", () => {
    expect(
      extractWildcardTypeNames('select u.*, o.* from "User" u join "Order" o on u.id = o."userId"'),
    ).toEqual(["User", "Order"]);
  });

  test("returns empty for explicit column list", () => {
    expect(extractWildcardTypeNames('select id, name from "User"')).toEqual([]);
  });

  test("returns empty for unparseable query", () => {
    expect(extractWildcardTypeNames("select from")).toEqual([]);
  });

  test("returns empty for COUNT(*)", () => {
    expect(extractWildcardTypeNames('select count(*) from "User"')).toEqual([]);
  });
});
