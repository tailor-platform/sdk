import { describe, expect, test } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { parseTypes } from "@/parser/service/tailordb";
import { toSchemaOutput } from "@/utils/test/internal";
import { processKyselyType } from "./type-processor";
import { kyselyTypePlugin, KyselyGeneratorID } from "./index";
import type { TailorDBType } from "@/parser/service/tailordb/types";
import type { TailorDBReadyContext } from "@/plugin/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "@/types/tailordb.generated";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name]!;
}

const mockBasicType = db.type("User", {
  name: db.string().description("User name"),
  email: db.string().description("User email"),
  age: db.int({ optional: true }),
  isActive: db.bool(),
  score: db.float({ optional: true }),
  birthDate: db.date({ optional: true }),
  lastLogin: db.datetime({ optional: true }),
  tags: db.string({ array: true }),
  ...db.fields.timestamps(),
});

const mockEnumType = db.type("Status", {
  status: db.enum([{ value: "active" }, { value: "inactive" }, { value: "pending" }]),
  priority: db.enum([{ value: "high" }, { value: "medium" }, { value: "low" }], { optional: true }),
});

const mockNestedType = db.type("ComplexUser", {
  profile: db.object({
    firstName: db.string(),
    lastName: db.string(),
  }),
  preferences: db.object(
    {
      key: db.string(),
      value: db.string(),
    },
    { optional: true, array: true },
  ),
  ...db.fields.timestamps(),
});

describe("KyselyTypePlugin integration tests", () => {
  const testDistPath = "/test/dist/kysely-types.ts";

  function createCtx(
    namespaces: { namespace: string; types: Record<string, TailorDBType> }[],
  ): TailorDBReadyContext<{ distPath: string }> {
    return {
      tailordb: namespaces.map((ns) => ({
        namespace: ns.namespace,
        types: ns.types,
        sourceInfo: new Map(),
        pluginAttachments: new Map(),
      })),
      auth: undefined,
      baseDir: "/test",
      configPath: "tailor.config.ts",
      pluginConfig: { distPath: testDistPath },
    };
  }

  describe("basic functionality tests", () => {
    test("processKyselyType correctly processes basic TailorDBType", async () => {
      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(mockBasicType)));

      expect(result.name).toBe("User");
      expect(result.typeDef).toContain("User: {");
      expect(result.typeDef).toContain("id: Generated<string>;");
      expect(result.typeDef).toContain("name: string;");
      expect(result.typeDef).toContain("email: string;");
      expect(result.typeDef).toContain("age: number | null;");
      expect(result.typeDef).toContain("isActive: boolean;");
      expect(result.typeDef).toContain("score: number | null;");
      expect(result.typeDef).toContain("birthDate: Timestamp | null;");
      expect(result.typeDef).toContain("lastLogin: Timestamp | null;");
      expect(result.typeDef).toContain("tags: string[];");
      expect(result.typeDef).toContain("createdAt: Generated<Timestamp>;");
      expect(result.typeDef).toContain("updatedAt: Timestamp | null;");
    });

    test("should have correct id and description", () => {
      const plugin = kyselyTypePlugin({ distPath: testDistPath });
      expect(plugin.id).toBe(KyselyGeneratorID);
      expect(plugin.description).toBe("Generates Kysely type definitions for TailorDB types");
    });
  });

  describe("type mapping tests", () => {
    test("correctly maps enum type to Kysely type", async () => {
      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(mockEnumType)));

      expect(result.typeDef).toContain('status: "active" | "inactive" | "pending";');
      expect(result.typeDef).toContain('priority: "high" | "medium" | "low" | null;');
    });

    test("correctly processes nested object type", async () => {
      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(mockNestedType)));

      expect(result.typeDef).toContain("ComplexUser: {");
      expect(result.typeDef).toContain("profile: {");
      expect(result.typeDef).toContain("firstName: string;");
      expect(result.typeDef).toContain("lastName: string;");
      expect(result.typeDef).toContain("};");
      expect(result.typeDef).toContain("preferences: {");
      expect(result.typeDef).toContain("key: string;");
      expect(result.typeDef).toContain("value: string;");
      expect(result.typeDef).toContain("}[] | null;");
    });

    test("correctly processes required/optional fields", async () => {
      const testType = db.type("TestRequired", {
        requiredField: db.string(),
        optionalField: db.string({ optional: true }),
        undefinedRequiredField: db.string({ optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(testType)));

      expect(result.typeDef).toContain("requiredField: string;");
      expect(result.typeDef).toContain("optionalField: string | null;");
      expect(result.typeDef).toContain("undefinedRequiredField: string | null;");
    });

    test("correctly processes array types", async () => {
      const arrayType = db.type("ArrayTest", {
        stringArray: db.string({ array: true }),
        optionalIntArray: db.int({ optional: true, array: true }),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(arrayType)));

      expect(result.typeDef).toContain("stringArray: string[];");
      expect(result.typeDef).toContain("optionalIntArray: number[] | null;");
    });
  });

  describe("onTailorDBReady tests", () => {
    test("integrates type definitions and returns file generation result", async () => {
      const parsedType = parseTailorDBType(toSchemaOutput(mockBasicType));
      const ctx = createCtx([
        {
          namespace: "test-namespace",
          types: { User: parsedType },
        },
      ]);

      const plugin = kyselyTypePlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.path).toBe(testDistPath);

      const content = result.files[0]!.content;
      expect(content).toContain("type Generated,");
      expect(content).toContain("type NamespaceTransaction");
      expect(content).toContain("type NamespaceInsertable");
      expect(content).toContain("type NamespaceSelectable");
      expect(content).toContain("type NamespaceUpdateable");
      expect(content).toContain("interface Namespace {");
      expect(content).toContain('"test-namespace": {');
      expect(content).toContain("User: {");
      expect(content).toContain("export const getDB");
      expect(content).toContain("export type Transaction<K extends keyof Namespace | DB");
      expect(content).toContain("export type Insertable<T extends TableName>");
      expect(content).toContain("export type Selectable<T extends TableName>");
      expect(content).toContain("export type Updateable<T extends TableName>");
      expect(result.errors).toBeUndefined();
    });

    test("complete integration test with multiple types", async () => {
      const parsedBasicType = parseTailorDBType(toSchemaOutput(mockBasicType));
      const parsedEnumType = parseTailorDBType(toSchemaOutput(mockEnumType));
      const ctx = createCtx([
        {
          namespace: "test-namespace",
          types: { User: parsedBasicType, Status: parsedEnumType },
        },
      ]);

      const plugin = kyselyTypePlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.path).toBe(testDistPath);

      const content = result.files[0]!.content;
      expect(content).toContain("User: {");
      expect(content).toContain("Status: {");
      expect(content).toContain("interface Namespace {");
      expect(content).toContain('"test-namespace": {');
    });
  });

  describe("error handling tests", () => {
    test("handles errors appropriately with invalid type definitions", async () => {
      const validType = parseTailorDBType(toSchemaOutput(mockBasicType));
      const invalidType: TailorDBType = {
        ...validType,
        name: "Invalid",
        // @ts-expect-error - intentionally invalid to verify runtime error handling
        fields: null,
      };

      await expect(processKyselyType(invalidType)).rejects.toThrow(
        "Cannot convert undefined or null to object",
      );
    });

    test("processes unknown type definitions as string type", async () => {
      const unknownType = db.type("UnknownType", {
        unknownField: db.string(),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(unknownType)));

      expect(result.typeDef).toContain("unknownField: string;");
    });
  });

  describe("multiple namespace support", () => {
    test("aggregates types from multiple namespaces", async () => {
      const userType = db.type("User", {
        name: db.string(),
      });
      const eventType = db.type("Event", {
        timestamp: db.datetime(),
      });

      const ctx = createCtx([
        {
          namespace: "tailordb",
          types: { User: parseTailorDBType(toSchemaOutput(userType)) },
        },
        {
          namespace: "analytics",
          types: { Event: parseTailorDBType(toSchemaOutput(eventType)) },
        },
      ]);

      const plugin = kyselyTypePlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      expect(result.files).toHaveLength(1);
      const content = result.files[0]!.content;

      // Check both namespaces are included
      expect(content).toContain('"tailordb": {');
      expect(content).toContain('"analytics": {');
      expect(content).toContain("User: {");
      expect(content).toContain("Event: {");

      // Check Timestamp utility type is imported (used by analytics)
      expect(content).toContain("type Timestamp,");
      expect(content).toContain("interface Namespace {");
    });

    test("includes only necessary utility types", async () => {
      const simpleType = db.type("Simple", {
        name: db.string(),
      });

      const ctx = createCtx([
        {
          namespace: "test",
          types: { Simple: parseTailorDBType(toSchemaOutput(simpleType)) },
        },
      ]);

      const plugin = kyselyTypePlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      const content = result.files[0]!.content;

      // Timestamp should not be imported (not used)
      expect(content).not.toContain("type Timestamp");
      // Generated should always be imported
      expect(content).toContain("type Generated,");
      // Serial should not be imported (not used)
      expect(content).not.toContain("type Serial");
    });
  });
});
