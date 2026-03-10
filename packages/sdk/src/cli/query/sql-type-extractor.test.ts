import { describe, expect, test } from "vitest";
import { extractColumnTemplate, extractTypeNamesFromSql } from "./sql-type-extractor";

describe("extractTypeNamesFromSql", () => {
  test("extracts table names using SQL parser", () => {
    const sql = `select * from "User" u join "Order" o on u.id = o.userId`;

    expect(extractTypeNamesFromSql(sql)).toEqual(["User", "Order"]);
  });

  test("throws with helpful message when parser cannot parse query", () => {
    const sql = "select from";

    expect(() => extractTypeNamesFromSql(sql)).toThrowError(/SQL parse error:/);
  });

  test("throws with suggestion to quote reserved keywords", () => {
    const sql = "SELECT * FROM User";

    expect(() => extractTypeNamesFromSql(sql)).toThrowError(/wrap it in double quotes/);
  });

  test("does not throw for parseable non-DML statements", () => {
    const sql = "create table t (id integer)";

    expect(() => extractTypeNamesFromSql(sql)).not.toThrow();
  });
});

describe("extractColumnTemplate", () => {
  test("returns wildcard slot for SELECT *", () => {
    expect(extractColumnTemplate('select * from "User"')).toEqual([
      { type: "wildcard", typeNames: ["User"] },
    ]);
  });

  test("returns wildcard slot with all types for SELECT * with JOIN", () => {
    expect(
      extractColumnTemplate('select * from "User" u join "Order" o on u.id = o."userId"'),
    ).toEqual([{ type: "wildcard", typeNames: ["User", "Order"] }]);
  });

  test("returns wildcard slot for qualified wildcard (u.*)", () => {
    expect(extractColumnTemplate('select u.* from "User" as u')).toEqual([
      { type: "wildcard", typeNames: ["User"] },
    ]);
  });

  test("returns only wildcard table for qualified wildcard in JOIN", () => {
    expect(
      extractColumnTemplate('select u.* from "User" u join "Order" o on u.id = o."userId"'),
    ).toEqual([{ type: "wildcard", typeNames: ["User"] }]);
  });

  test("returns separate wildcard slots in declaration order", () => {
    expect(
      extractColumnTemplate('select o.*, u.* from "User" u join "Order" o on u.id = o."userId"'),
    ).toEqual([
      { type: "wildcard", typeNames: ["Order"] },
      { type: "wildcard", typeNames: ["User"] },
    ]);
  });

  test("returns mixed explicit and wildcard slots preserving SQL declaration order", () => {
    expect(
      extractColumnTemplate(
        'select o.id as "orderId", u.*, o.name as "orderName" from "User" u join "Order" o on u.id = o."userId"',
      ),
    ).toEqual([
      { type: "explicit", name: "orderId" },
      { type: "wildcard", typeNames: ["User"] },
      { type: "explicit", name: "orderName" },
    ]);
  });

  test("returns null for explicit column list", () => {
    expect(extractColumnTemplate('select id, name from "User"')).toBeNull();
  });

  test("returns null for unparseable query", () => {
    expect(extractColumnTemplate("select from")).toBeNull();
  });

  test("returns null for COUNT(*)", () => {
    expect(extractColumnTemplate('select count(*) from "User"')).toBeNull();
  });
});
