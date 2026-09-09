import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutputs } from "#/utils/test/internal";
import { buildSeedNamespaceConfigs } from "./seed-type-processor";
import type { TailorDBType, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";
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

/**
 * Build a minimal TailorDB type for seed processor tests.
 * @param name - Table name
 * @param fields - Field configs, keyed by field name
 * @returns A type usable wherever a parsed TailorDB table is expected
 */
function makeType(name: string, fields: TailorDBType["fields"]): TailorDBType {
  return { name, fields } as TailorDBType;
}

function makeNamespace(namespace: string, types: TailorDBType[]): TailorDBNamespaceData {
  return {
    namespace,
    tables: Object.fromEntries(types.map((type) => [type.name, type])),
    sourceInfo: new Map(
      types.map((type) => [type.name, { filePath: `/src/${type.name}.ts`, exportName: type.name }]),
    ),
    pluginAttachments: new Map(),
  };
}

describe("buildSeedNamespaceConfigs", () => {
  describe("requiredFields", () => {
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

  describe("omitFields", () => {
    test("omits a serial field with no incoming relation", () => {
      const user = makeType("User", {
        id: { name: "id", config: { type: "string" } },
        code: { name: "code", config: { type: "integer", serial: { start: 1 } } },
      });

      const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [user])]);

      expect(config?.omitFields?.User).toEqual(["code"]);
    });

    test("keeps a serial field that another table's relation is keyed to", () => {
      const user = makeType("User", {
        id: { name: "id", config: { type: "string" } },
        code: { name: "code", config: { type: "integer", serial: { start: 1 } } },
      });
      const order = makeType("Order", {
        id: { name: "id", config: { type: "string" } },
        user: {
          name: "user",
          config: { type: "string" },
          relation: {
            targetType: "User",
            forwardName: "user",
            backwardName: "orders",
            key: "code",
            unique: false,
          },
        },
      });

      const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [user, order])]);

      // `code` is serial, so it would normally be dropped from the dump, but
      // Order.user is keyed to it: dropping it would leave apply --truncate
      // assigning User a fresh `code` while Order still points at the old one.
      expect(config?.omitFields?.User).toEqual([]);
      expect(config?.omitFields?.Order).toEqual([]);
    });

    test("keeps a serial field a keyOnly relation is keyed to", () => {
      // A keyOnly relation never populates `field.relation` (see
      // buildRelationInfo in relation.ts); it only sets
      // `field.config.foreignKeyType`/`foreignKeyField`.
      const user = makeType("User", {
        id: { name: "id", config: { type: "string" } },
        code: { name: "code", config: { type: "integer", serial: { start: 1 } } },
      });
      const order = makeType("Order", {
        id: { name: "id", config: { type: "string" } },
        userCode: {
          name: "userCode",
          config: { type: "integer", foreignKeyType: "User", foreignKeyField: "code" },
        },
      });

      const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [user, order])]);

      expect(config?.omitFields?.User).toEqual([]);
    });
  });

  describe("selfRefFields", () => {
    test("names the field a self-referencing relation is keyed through", () => {
      const category = makeType("Category", {
        id: { name: "id", config: { type: "string" } },
        parentId: {
          name: "parentId",
          config: { type: "string" },
          relation: {
            targetType: "Category",
            forwardName: "parent",
            backwardName: "children",
            key: "id",
            unique: false,
          },
        },
      });

      const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [category])]);

      // The seed script (bundler.ts) uses this to order same-table inserts
      // so a row is never inserted before the row it references.
      expect(config?.selfRefFields?.Category).toEqual(["parentId"]);
      expect(config?.selfRefTypes).toEqual(["Category"]);
    });

    test("is empty for a table with no self-referencing fields", () => {
      const user = makeType("User", {
        id: { name: "id", config: { type: "string" } },
      });

      const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [user])]);

      expect(config?.selfRefFields?.User).toEqual([]);
      expect(config?.selfRefTypes).toEqual([]);
    });
  });
});
