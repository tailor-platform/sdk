import { describe, expect, test } from "vitest";
import { renderSqlDeclaration, renderSqlModule } from "./render";
import type { SqlAnalysis } from "./analyze";

const analysis: SqlAnalysis = {
  namespace: "main",
  text: 'SELECT "id", "orderDate" FROM "Order" WHERE "status" = $1',
  paramNames: ["status"],
  params: [{ name: "status", type: '"PAID" | "PENDING"' }],
  columns: [
    { name: "id", type: "string" },
    { name: "order-date", type: "Temporal.PlainDate" },
  ],
  cardinality: "many",
  usesTemporal: true,
};

describe("renderSqlDeclaration", () => {
  test("declares the query with its params, row and cardinality", () => {
    expect(renderSqlDeclaration(analysis)).toBe(
      [
        'import type { SqlQuery } from "@tailor-platform/sdk/runtime/sql";',
        'import type { Temporal } from "@tailor-platform/sdk/runtime";',
        'declare const query: SqlQuery<{ status: "PAID" | "PENDING" }, { id: string; "order-date": Temporal.PlainDate }, "many">;',
        "export default query;",
        "",
      ].join("\n"),
    );
  });

  test("uses empty object types when there are no params or columns", () => {
    expect(
      renderSqlDeclaration({
        ...analysis,
        params: [],
        columns: [],
        cardinality: "none",
        usesTemporal: false,
      }),
    ).toBe(
      [
        'import type { SqlQuery } from "@tailor-platform/sdk/runtime/sql";',
        'declare const query: SqlQuery<Record<never, never>, Record<never, never>, "none">;',
        "export default query;",
        "",
      ].join("\n"),
    );
  });

  test("declares a loosely typed query when the file has problems", () => {
    expect(renderSqlDeclaration(undefined)).toBe(
      [
        'import type { SqlClient } from "@tailor-platform/sdk/runtime/sql";',
        "declare const query: { readonly namespace: string; readonly sql: string; run(client: SqlClient, params?: Record<string, unknown>): Promise<any> };",
        "export default query;",
        "",
      ].join("\n"),
    );
  });
});

describe("renderSqlModule", () => {
  test("creates the query from the analysis", () => {
    expect(renderSqlModule(analysis)).toBe(
      [
        'import { createSqlQuery } from "@tailor-platform/sdk/runtime/sql";',
        `export default createSqlQuery(${JSON.stringify({
          namespace: "main",
          sql: analysis.text,
          paramNames: ["status"],
          cardinality: "many",
        })});`,
        "",
      ].join("\n"),
    );
  });
});
