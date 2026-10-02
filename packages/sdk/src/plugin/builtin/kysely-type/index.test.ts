import { describe, expect, test, vi } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { processKyselyType } from "./type-processor";
import { kyselyTypePlugin, KyselyGeneratorID } from "./index";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBNamespaceData, TailorDBReadyContext } from "#/plugin/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name]!;
}

const mockBasicType = db.table("User", {
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

const mockEnumType = db.table("Status", {
  status: db.enum([{ value: "active" }, { value: "inactive" }, { value: "pending" }]),
  priority: db.enum([{ value: "high" }, { value: "medium" }, { value: "low" }], { optional: true }),
});

const mockNestedType = db.table("ComplexUser", {
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
    namespaces: { namespace: string; tables: Record<string, TailorDBType> }[],
  ): TailorDBReadyContext<{ distPath: string }> {
    return {
      tailordb: namespaces.map((ns) => ({
        namespace: ns.namespace,
        tables: ns.tables,
        sourceInfo: new Map(),
        pluginAttachments: new Map(),
      })),
      auth: undefined,
      baseDir: "/test",
      configPath: "tailor.config.ts",
      pluginConfig: { distPath: testDistPath },
      loadTailorDB: () => {
        throw new Error("loadTailorDB is not expected to be called");
      },
    };
  }

  async function runOnTailorDBReady(
    namespaces: { namespace: string; tables: Record<string, TailorDBType> }[],
  ) {
    const plugin = kyselyTypePlugin({ distPath: testDistPath });
    return plugin.onTailorDBReady!(createCtx(namespaces));
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
      expect(result.typeDef).toContain("updatedAt: Generated<Timestamp>;");
    });

    test("should have correct id and description", () => {
      const plugin = kyselyTypePlugin({ distPath: testDistPath });
      expect(plugin.id).toBe(KyselyGeneratorID);
      expect(plugin.description).toBe("Generates Kysely type definitions for TailorDB tables");
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
      const testType = db.table("TestRequired", {
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
      const arrayType = db.table("ArrayTest", {
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
      const result = await runOnTailorDBReady([
        {
          namespace: "test-namespace",
          tables: { User: parseTailorDBType(toSchemaOutput(mockBasicType)) },
        },
      ]);

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
      const result = await runOnTailorDBReady([
        {
          namespace: "test-namespace",
          tables: {
            User: parseTailorDBType(toSchemaOutput(mockBasicType)),
            Status: parseTailorDBType(toSchemaOutput(mockEnumType)),
          },
        },
      ]);

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
      const unknownType = db.table("UnknownType", {
        unknownField: db.string(),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(unknownType)));

      expect(result.typeDef).toContain("unknownField: string;");
    });
  });

  describe("multiple namespace support", () => {
    test("aggregates types from multiple namespaces", async () => {
      const userType = db.table("User", { name: db.string() });
      const eventType = db.table("Event", { timestamp: db.datetime() });

      const result = await runOnTailorDBReady([
        {
          namespace: "tailordb",
          tables: { User: parseTailorDBType(toSchemaOutput(userType)) },
        },
        {
          namespace: "analytics",
          tables: { Event: parseTailorDBType(toSchemaOutput(eventType)) },
        },
      ]);

      expect(result.files).toHaveLength(1);
      const content = result.files[0]!.content;

      expect(content).toContain('"tailordb": {');
      expect(content).toContain('"analytics": {');
      expect(content).toContain("User: {");
      expect(content).toContain("Event: {");
      expect(content).toContain("type Timestamp,");
      expect(content).toContain("interface Namespace {");
    });

    test("includes only necessary utility types", async () => {
      const simpleType = db.table("Simple", { name: db.string() });

      const result = await runOnTailorDBReady([
        {
          namespace: "test",
          tables: { Simple: parseTailorDBType(toSchemaOutput(simpleType)) },
        },
      ]);

      const content = result.files[0]!.content;

      expect(content).not.toContain("type Timestamp");
      expect(content).toContain("type Generated,");
      expect(content).not.toContain("type Serial");
    });

    test("imports ObjectColumnType and ArrayColumnType when the wrappers are emitted", async () => {
      const type = db.table("Profile", {
        metadata: db.object({ created: db.datetime(), version: db.int() }, { array: true }),
      });

      const result = await runOnTailorDBReady([
        {
          namespace: "test",
          tables: { Profile: parseTailorDBType(toSchemaOutput(type)) },
        },
      ]);

      const content = result.files[0]!.content;

      expect(content).toContain("ArrayColumnType<ObjectColumnType<");
      expect(content).toContain("type ObjectColumnType");
      expect(content).toContain("type ArrayColumnType");
    });

    test("omits wrapper imports for enum values naming them", async () => {
      const type = db.table("Status", {
        kind: db.enum([
          { value: "ObjectColumnType<Timestamp>" },
          { value: "ArrayColumnType<Timestamp>" },
        ]),
      });

      const result = await runOnTailorDBReady([
        {
          namespace: "test",
          tables: { Status: parseTailorDBType(toSchemaOutput(type)) },
        },
      ]);

      const content = result.files[0]!.content;

      expect(content).toContain(
        'kind: "ObjectColumnType<Timestamp>" | "ArrayColumnType<Timestamp>";',
      );
      expect(content).not.toContain("type ObjectColumnType");
      expect(content).not.toContain("type ArrayColumnType");
      expect(content).not.toContain("type Timestamp");
    });
  });

  describe("additionalNamespaces", () => {
    const invoiceType = db.table("Invoice", { amount: db.int() });
    const ownNamespaces = [
      { namespace: "tailordb", tables: { User: parseTailorDBType(toSchemaOutput(mockBasicType)) } },
    ];

    function fakeLoadTailorDB() {
      return vi.fn(
        async (_configPath: string, namespaces: string[]): Promise<TailorDBNamespaceData[]> =>
          namespaces.map((namespace) => ({
            namespace,
            tables: { Invoice: parseTailorDBType(toSchemaOutput(invoiceType)) },
            sourceInfo: new Map(),
            pluginAttachments: new Map(),
          })),
      );
    }

    function runWithAdditionalNamespaces(
      additionalNamespaces: unknown,
      loadTailorDB: TailorDBReadyContext["loadTailorDB"],
    ) {
      const options = {
        distPath: testDistPath,
        additionalNamespaces: additionalNamespaces as {
          configPath: string;
          namespaces?: string[];
        }[],
      };
      return kyselyTypePlugin(options).onTailorDBReady!({
        ...createCtx(ownNamespaces),
        configPath: "/app/tailor.config.ts",
        pluginConfig: options,
        loadTailorDB,
      });
    }

    test("adds a namespace loaded from another config to the generated Namespace interface", async () => {
      const loadTailorDB = fakeLoadTailorDB();

      const result = await runWithAdditionalNamespaces(
        [{ configPath: "../billing/tailor.config.ts", namespaces: ["billing"] }],
        loadTailorDB,
      );

      expect(loadTailorDB).toHaveBeenCalledWith("/billing/tailor.config.ts", ["billing"]);
      const content = result.files[0]!.content;
      expect(content).toContain('"tailordb": {');
      expect(content).toContain('"billing": {');
      expect(content).toContain("Invoice: {");
    });

    test("keeps a table name shared with this config's namespaces under each namespace", async () => {
      const result = await runWithAdditionalNamespaces(
        [{ configPath: "../billing/tailor.config.ts", namespaces: ["billing"] }],
        async (_configPath, namespaces = []) =>
          namespaces.map((namespace) => ({
            namespace,
            tables: {
              User: parseTailorDBType(toSchemaOutput(db.table("User", { plan: db.string() }))),
            },
            sourceInfo: new Map(),
            pluginAttachments: new Map(),
          })),
      );

      const content = result.files[0]!.content;
      expect(content).toMatch(/"tailordb": \{\n {4}User: \{[^}]*email: string;/);
      expect(content).toMatch(/"billing": \{\n {4}User: \{[^}]*plan: string;/);
    });

    test("rejects an additional namespace whose name is already a namespace of this config", async () => {
      const loadTailorDB = fakeLoadTailorDB();

      await expect(
        runWithAdditionalNamespaces(
          [{ configPath: "../billing/tailor.config.ts", namespaces: ["tailordb"] }],
          loadTailorDB,
        ),
      ).rejects.toThrow(
        'additionalNamespaces: namespace "tailordb" is already defined in this config\'s db.',
      );
      expect(loadTailorDB).not.toHaveBeenCalled();
    });

    test("rejects the same namespace listed twice in additionalNamespaces", async () => {
      const loadTailorDB = fakeLoadTailorDB();

      await expect(
        runWithAdditionalNamespaces(
          [
            { configPath: "../billing/tailor.config.ts", namespaces: ["billing"] },
            { configPath: "../legacy/tailor.config.ts", namespaces: ["billing"] },
          ],
          loadTailorDB,
        ),
      ).rejects.toThrow('additionalNamespaces: namespace "billing" is included more than once.');
      expect(loadTailorDB).not.toHaveBeenCalled();
    });

    test("names the additionalNamespaces entry when loading it fails", async () => {
      const loadTailorDB = vi.fn(async () => {
        throw new Error('TailorDB namespace "billing" is not defined');
      });

      await expect(
        runWithAdditionalNamespaces(
          [{ configPath: "../billing/tailor.config.ts", namespaces: ["billing"] }],
          loadTailorDB,
        ),
      ).rejects.toThrow(
        'additionalNamespaces[0]: failed to load from /billing/tailor.config.ts: TailorDB namespace "billing" is not defined',
      );
    });

    test.each([
      [
        "a non-array",
        { configPath: "../billing/tailor.config.ts" },
        "additionalNamespaces must be an array.",
      ],
      [
        "a non-object entry",
        ["../billing/tailor.config.ts"],
        "additionalNamespaces[0] must be an object.",
      ],
      [
        "an entry without configPath",
        [{ namespaces: ["billing"] }],
        "additionalNamespaces[0].configPath must be a non-empty string.",
      ],
      [
        "an empty configPath",
        [{ configPath: "", namespaces: ["billing"] }],
        "additionalNamespaces[0].configPath must be a non-empty string.",
      ],
      [
        "a string namespaces",
        [{ configPath: "../billing/tailor.config.ts", namespaces: "billing" }],
        "additionalNamespaces[0].namespaces must be a non-empty array of non-empty strings.",
      ],
      [
        "an empty namespaces array",
        [{ configPath: "../billing/tailor.config.ts", namespaces: [] }],
        "additionalNamespaces[0].namespaces must be a non-empty array of non-empty strings.",
      ],
      [
        "a non-string namespace in a later entry",
        [
          { configPath: "../billing/tailor.config.ts", namespaces: ["billing"] },
          { configPath: "../audit/tailor.config.ts", namespaces: ["audit", 1] },
        ],
        "additionalNamespaces[1].namespaces must be a non-empty array of non-empty strings.",
      ],
      [
        "a hole in the entries",
        Object.assign([], { 1: { configPath: "../billing/tailor.config.ts" } }),
        "additionalNamespaces[0] must be an object.",
      ],
      [
        "a hole in namespaces",
        [
          {
            configPath: "../billing/tailor.config.ts",
            namespaces: Object.assign(["billing"], { 2: "audit" }),
          },
        ],
        "additionalNamespaces[0].namespaces must be a non-empty array of non-empty strings.",
      ],
    ])("rejects %s before loading anything", async (_case, additionalNamespaces, message) => {
      const loadTailorDB = fakeLoadTailorDB();

      await expect(runWithAdditionalNamespaces(additionalNamespaces, loadTailorDB)).rejects.toThrow(
        message,
      );
      expect(loadTailorDB).not.toHaveBeenCalled();
    });

    describe("when namespaces is omitted", () => {
      function loadTailorDBReturning(...namespaces: string[]) {
        return vi.fn(
          async (_configPath: string, _namespaces?: string[]): Promise<TailorDBNamespaceData[]> =>
            namespaces.map((namespace) => ({
              namespace,
              tables: { Invoice: parseTailorDBType(toSchemaOutput(invoiceType)) },
              sourceInfo: new Map(),
              pluginAttachments: new Map(),
            })),
        );
      }

      test("adds every namespace the loader returns for that config", async () => {
        const loadTailorDB = loadTailorDBReturning("billing", "audit");

        const result = await runWithAdditionalNamespaces(
          [{ configPath: "../billing/tailor.config.ts" }],
          loadTailorDB,
        );

        expect(loadTailorDB).toHaveBeenCalledWith("/billing/tailor.config.ts", undefined);
        const content = result.files[0]!.content;
        expect(content).toContain('"billing": {');
        expect(content).toContain('"audit": {');
      });

      test("rejects a loaded namespace whose name is already a namespace of this config", async () => {
        await expect(
          runWithAdditionalNamespaces(
            [{ configPath: "../billing/tailor.config.ts" }],
            loadTailorDBReturning("billing", "tailordb"),
          ),
        ).rejects.toThrow(
          'additionalNamespaces: namespace "tailordb" is already defined in this config\'s db.',
        );
      });

      test("rejects pointing configPath at this config itself", async () => {
        const loadTailorDB = loadTailorDBReturning("tailordb");

        await expect(
          runWithAdditionalNamespaces([{ configPath: "./tailor.config.ts" }], loadTailorDB),
        ).rejects.toThrow(
          'additionalNamespaces: namespace "tailordb" is already defined in this config\'s db.',
        );
        expect(loadTailorDB).toHaveBeenCalledWith("/app/tailor.config.ts", undefined);
      });

      test("rejects a namespace loaded from more than one entry", async () => {
        await expect(
          runWithAdditionalNamespaces(
            [
              { configPath: "../billing/tailor.config.ts" },
              { configPath: "../legacy/tailor.config.ts", namespaces: ["billing"] },
            ],
            loadTailorDBReturning("billing"),
          ),
        ).rejects.toThrow('additionalNamespaces: namespace "billing" is included more than once.');
      });
    });
  });
});
