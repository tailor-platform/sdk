import { describe, expect, test } from "vitest";
import { normalizeDb } from "./normalize-db";
import { AppConfigSchema } from "./schema";

describe("TailorDB configuration", () => {
  test.each([
    { files: [] },
    { external: true },
    { attach: true },
    { attach: true, schemaFrom: "../owner/tailor.config.ts" },
    { attach: false, schemaFrom: "../owner/tailor.config.ts" },
  ])("accepts %j", (entry) => {
    expect(AppConfigSchema.safeParse({ name: "app", db: { shared: entry } }).success).toBe(true);
  });

  test.each([
    { files: [], attach: true },
    { files: [], schemaFrom: "owner.ts" },
    { files: [], external: true },
    { attach: false },
    { schemaFrom: "owner.ts" },
    { external: true, attach: true },
    { external: true, schemaFrom: "owner.ts" },
    { attach: true, ignores: [] },
    { attach: true, migration: { directory: "migrations" } },
    { attach: true, gqlOperations: {} },
    { attach: false, schemaFrom: "" },
    {},
    "invalid",
  ])("rejects %j", (entry) => {
    expect(AppConfigSchema.safeParse({ name: "app", db: { shared: entry } }).success).toBe(false);
  });

  test("normalizes referenced definitions independently of subgraph membership", () => {
    expect(
      normalizeDb({
        visible: { attach: true },
        shared: { attach: true, schemaFrom: "owner.ts" },
        sql: { attach: false, schemaFrom: "other.ts" },
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
