import { describe, expect, test } from "vitest";
import { normalizeDb } from "./normalize-db";
import { AppConfigSchema } from "./schema";

describe("TailorDB configuration", () => {
  test.each([
    { files: [] },
    { external: true },
    { subgraph: true },
    { subgraph: true, schemaFrom: "../owner/tailor.config.ts" },
    { subgraph: false, schemaFrom: "../owner/tailor.config.ts" },
  ])("accepts %j", (entry) => {
    expect(AppConfigSchema.safeParse({ name: "app", db: { shared: entry } }).success).toBe(true);
  });

  test.each([
    { files: [], subgraph: true },
    { files: [], schemaFrom: "owner.ts" },
    { files: [], external: true },
    { subgraph: false },
    { schemaFrom: "owner.ts" },
    { external: true, subgraph: true },
    { external: true, schemaFrom: "owner.ts" },
    { subgraph: true, ignores: [] },
    { subgraph: true, migration: { directory: "migrations" } },
    { subgraph: true, gqlOperations: {} },
    { subgraph: false, schemaFrom: "" },
    {},
    "invalid",
  ])("rejects %j", (entry) => {
    expect(AppConfigSchema.safeParse({ name: "app", db: { shared: entry } }).success).toBe(false);
  });

  test("normalizes referenced definitions independently of subgraph membership", () => {
    expect(
      normalizeDb({
        visible: { subgraph: true },
        shared: { subgraph: true, schemaFrom: "owner.ts" },
        sql: { subgraph: false, schemaFrom: "other.ts" },
      }),
    ).toEqual({
      visible: { owned: false, inSubgraph: true, schemaSource: undefined },
      shared: {
        owned: false,
        inSubgraph: true,
        schemaSource: { kind: "config", path: "owner.ts" },
      },
      sql: { owned: false, inSubgraph: false, schemaSource: { kind: "config", path: "other.ts" } },
    });
  });
});
