import { describe, it, expect, beforeEach } from "vitest";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { db } from "@/configure/services/tailordb/schema";
import { KyselyGenerator } from "./index";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

function parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
  const service = new TailorDBService("test", { files: [] });
  service["rawTypes"]["test.ts"] = { [type.name]: type };
  service["parseTypes"]();
  return service.getTypes()[type.name];
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

describe("KyselyGenerator integration tests", () => {
  let kyselyGenerator: KyselyGenerator;
  const testDistPath = "/test/dist/kysely-types.ts";

  beforeEach(() => {
    kyselyGenerator = new KyselyGenerator({ distPath: testDistPath });
  });

  describe("basic functionality tests", () => {
    it("processType method correctly processes basic TailorDBType", async () => {
      const result = await kyselyGenerator.processType({
        type: parseTailorDBType(mockBasicType),
        namespace: "test-namespace",
      });

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

    it("should have correct dependencies", () => {
      expect(kyselyGenerator.dependencies).toEqual(["tailordb"]);
    });
  });

  describe("type mapping tests", () => {
    it("correctly maps enum type to Kysely type", async () => {
      const result = await kyselyGenerator.processType({
        type: parseTailorDBType(mockEnumType),
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain('status: "active" | "inactive" | "pending";');
      expect(result.typeDef).toContain('priority: "high" | "medium" | "low" | null;');
    });

    it("correctly processes nested object type", async () => {
      const result = await kyselyGenerator.processType({
        type: parseTailorDBType(mockNestedType),
        namespace: "test-namespace",
      });

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

    it("correctly processes required/optional fields", async () => {
      const testType = db.type("TestRequired", {
        requiredField: db.string(),
        optionalField: db.string({ optional: true }),
        undefinedRequiredField: db.string({ optional: true }),
      });

      const result = await kyselyGenerator.processType({
        type: parseTailorDBType(testType),
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("requiredField: string;");
      expect(result.typeDef).toContain("optionalField: string | null;");
      expect(result.typeDef).toContain("undefinedRequiredField: string | null;");
    });

    it("correctly processes array types", async () => {
      const arrayType = db.type("ArrayTest", {
        stringArray: db.string({ array: true }),
        optionalIntArray: db.int({ optional: true, array: true }),
      });

      const result = await kyselyGenerator.processType({
        type: parseTailorDBType(arrayType),
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("stringArray: string[];");
      expect(result.typeDef).toContain("optionalIntArray: number[] | null;");
    });
  });

  describe("processTailorDBNamespace method tests", () => {
    it("returns JSON metadata for namespace", async () => {
      const typeMetadata = {
        User: {
          name: "User",
          typeDef: `User: {
  id: Generated<string>;
  name: string;
  email: string;
}`,
          usedUtilityTypes: {
            Timestamp: false,
            Serial: false,
          },
        },
        Post: {
          name: "Post",
          typeDef: `Post: {
  id: Generated<string>;
  title: string;
  content: string;
}`,
          usedUtilityTypes: {
            Timestamp: false,
            Serial: false,
          },
        },
      };

      const result = await kyselyGenerator.processTailorDBNamespace({
        namespace: "test-namespace",
        types: typeMetadata,
      });

      // Result should be object
      expect(result.namespace).toBe("test-namespace");
      expect(result.types).toHaveLength(2);
      expect(result.types[0].name).toBe("User");
      expect(result.types[1].name).toBe("Post");
      expect(result.usedUtilityTypes).toEqual({
        Timestamp: false,
        Serial: false,
      });
    });

    it("returns metadata with empty types array for empty type definitions", async () => {
      const result = await kyselyGenerator.processTailorDBNamespace({
        namespace: "test-namespace",
        types: {},
      });

      expect(result.namespace).toBe("test-namespace");
      expect(result.types).toEqual([]);
      expect(result.usedUtilityTypes).toEqual({
        Timestamp: false,
        Serial: false,
      });
    });
  });

  describe("aggregate function tests", () => {
    it("integrates type definitions and returns file generation result", () => {
      // Metadata object from processTailorDBNamespace
      const processedTypes = {
        namespace: "test-namespace",
        types: [
          {
            name: "User",
            typeDef: `User: {
              id: Generated<string>;
              name: string;
              email: string;
            }`,
            usedUtilityTypes: { Timestamp: false, Serial: false },
          },
        ],
        usedUtilityTypes: { Timestamp: false, Serial: false },
      };

      const input = {
        tailordb: [
          {
            namespace: "test-namespace",
            types: processedTypes,
          },
        ],
      };
      const result = kyselyGenerator.aggregate({
        input: input,
        baseDir: "/test",
        configPath: "tailor.config.ts",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(testDistPath);

      const content = result.files[0].content;
      expect(content).toContain('import { type ColumnType, Kysely, KyselyConfig } from "kysely"');
      expect(content).toContain("interface Namespace {");
      expect(content).toContain('"test-namespace": {');
      expect(content).toContain("User: {");
      expect(content).toContain("export function getDB");
      expect(result.errors).toBeUndefined();
    });

    it("complete integration test with multiple types", async () => {
      const types = {
        User: await kyselyGenerator.processType({
          type: parseTailorDBType(mockBasicType),
          namespace: "test-namespace",
        }),
        Status: await kyselyGenerator.processType({
          type: parseTailorDBType(mockEnumType),
          namespace: "test-namespace",
        }),
      };

      const processedTypes = await kyselyGenerator.processTailorDBNamespace({
        namespace: "test-namespace",
        types: types,
      });
      const input = {
        tailordb: [
          {
            namespace: "test-namespace",
            types: processedTypes,
          },
        ],
      };
      const result = kyselyGenerator.aggregate({
        input: input,
        baseDir: "/test",
        configPath: "tailor.config.ts",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(testDistPath);

      const content = result.files[0].content;
      expect(content).toContain("User: {");
      expect(content).toContain("Status: {");
      expect(content).toContain("interface Namespace {");
      expect(content).toContain('"test-namespace": {');
    });
  });

  describe("error handling tests", () => {
    it("handles errors appropriately with invalid type definitions", async () => {
      const invalidType = {
        name: "Invalid",
        fields: null, // Invalid field
        options: {},
        metadata: {},
        hooks: {},
        _output: {},
      } as any;

      await expect(
        kyselyGenerator.processType({
          type: invalidType,
          namespace: "test-namespace",
        }),
      ).rejects.toThrow();
    });

    it("processes unknown type definitions as string type", async () => {
      const unknownType = db.type("UnknownType", {
        unknownField: db.string(),
      });

      const result = await kyselyGenerator.processType({
        type: parseTailorDBType(unknownType),
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("unknownField: string;");
    });
  });

  describe("multiple namespace support", () => {
    it("aggregates types from multiple namespaces", () => {
      const tailordbTypes = {
        namespace: "tailordb",
        types: [
          {
            name: "User",
            typeDef: `User: {
              id: Generated<string>;
              name: string;
            }`,
            usedUtilityTypes: { Timestamp: false, Serial: false },
          },
        ],
        usedUtilityTypes: { Timestamp: false, Serial: false },
      };

      const analyticsTypes = {
        namespace: "analytics",
        types: [
          {
            name: "Event",
            typeDef: `Event: {
              id: Generated<string>;
              timestamp: Timestamp;
            }`,
            usedUtilityTypes: { Timestamp: true, Serial: false },
          },
        ],
        usedUtilityTypes: { Timestamp: true, Serial: false },
      };

      const input = {
        tailordb: [
          { namespace: "tailordb", types: tailordbTypes },
          { namespace: "analytics", types: analyticsTypes },
        ],
      };

      const result = kyselyGenerator.aggregate({
        input,
        baseDir: "/test",
        configPath: "tailor.config.ts",
      });

      expect(result.files).toHaveLength(1);
      const content = result.files[0].content;

      // Check both namespaces are included
      expect(content).toContain('"tailordb": {');
      expect(content).toContain('"analytics": {');
      expect(content).toContain("User: {");
      expect(content).toContain("Event: {");

      // Check Timestamp utility type is included (used by analytics)
      expect(content).toContain("type Timestamp = ColumnType");
      expect(content).toContain("interface Namespace {");
    });

    it("includes only necessary utility types", () => {
      const types = {
        namespace: "test",
        types: [
          {
            name: "Simple",
            typeDef: `Simple: {
              id: Generated<string>;
              name: string;
            }`,
            usedUtilityTypes: { Timestamp: false, Serial: false },
          },
        ],
        usedUtilityTypes: { Timestamp: false, Serial: false },
      };

      const input = {
        tailordb: [{ namespace: "test", types }],
      };

      const result = kyselyGenerator.aggregate({
        input,
        baseDir: "/test",
        configPath: "tailor.config.ts",
      });

      const content = result.files[0].content;

      // Timestamp should not be included
      expect(content).not.toContain("type Timestamp = ColumnType");
      // Generated should always be included
      expect(content).toContain("type Generated<T>");
      // Serial should not be included
      expect(content).not.toContain("type Serial<T");
    });
  });
});
