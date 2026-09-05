import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutputs } from "#/utils/test/internal";
import { buildSeedNamespaceConfigs } from "./seed-type-processor";
import type { TypeSourceInfoEntry } from "#/parser/service/tailordb/types";
import type { TailorDBNamespaceData } from "#/plugin/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.table() result for testing
function namespaceData(tables: Record<string, any>): TailorDBNamespaceData {
  const sourceInfo = new Map<string, TypeSourceInfoEntry>(
    Object.keys(tables).map((name) => [name, { filePath: `/test/${name}.ts`, exportName: name }]),
  );
  return {
    namespace: "test",
    tables: parseTypes(toSchemaOutputs(tables), "test", Object.fromEntries(sourceInfo)),
    sourceInfo,
    pluginAttachments: new Map(),
  };
}

function requiredFieldsOf(tables: Record<string, unknown>): Record<string, string[]> {
  const [config] = buildSeedNamespaceConfigs([namespaceData(tables)]);
  return config!.requiredFields;
}

describe("buildSeedNamespaceConfigs", () => {
  test("keeps required fields the user has to supply", () => {
    const requiredFields = requiredFieldsOf({
      User: db.table("User", { name: db.string(), email: db.string() }),
    });

    expect(requiredFields.User).toEqual(["name", "email"]);
  });

  test("does not require timestamps() fields (createdAt/updatedAt)", () => {
    const requiredFields = requiredFieldsOf({
      User: db.table("User", { name: db.string(), ...db.fields.timestamps() }),
    });

    expect(requiredFields.User).toEqual(["name"]);
  });

  test("does not require a field with a custom default", () => {
    const requiredFields = requiredFieldsOf({
      Order: db.table("Order", {
        status: db.string().default("pending"),
        priority: db.int(),
      }),
    });

    expect(requiredFields.Order).toEqual(["priority"]);
  });

  test("does not require create-hook or serial fields", () => {
    const requiredFields = requiredFieldsOf({
      Invoice: db.table("Invoice", {
        number: db.string().serial({ start: 1000 }),
        issuedBy: db.string().hooks({ create: () => "system" }),
        total: db.int(),
      }),
    });

    expect(requiredFields.Invoice).toEqual(["total"]);
  });
});
