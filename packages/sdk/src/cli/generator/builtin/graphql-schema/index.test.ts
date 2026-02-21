import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { parseTypes } from "@/parser/service/tailordb";
import { toSchemaOutput } from "@/utils/test/internal";
import { createGqlSchemaGenerator, processType } from "./index";
import type { UserDefinedTypeSource, PluginGeneratedTypeSource } from "@/cli/generator/types";
import type { TailorDBType, TailorDBTypeSchemaOutput } from "@/parser/service/tailordb/types";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name];
}

const userSource: UserDefinedTypeSource = {
  filePath: "tailordb/user.ts",
  exportName: "user",
};

const pluginSource: PluginGeneratedTypeSource = {
  exportName: "generatedType",
  pluginId: "some-plugin",
  pluginImportPath: "@some/plugin",
  originalFilePath: "tailordb/original.ts",
  originalExportName: "original",
};

describe("processType", () => {
  it("extracts metadata from a basic TailorDB type", () => {
    const type = parseTailorDBType(
      toSchemaOutput(
        db.type("User", {
          name: db.string(),
          email: db.string(),
        }),
      ),
    );

    const result = processType({ type, source: userSource });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("User");
    // Default: all operations enabled
    const opNames = result!.entries.map((e) => e.operationName);
    expect(opNames).toContain("user"); // get
    expect(opNames).toContain("users"); // list
    expect(opNames).toContain("createUser");
    expect(opNames).toContain("updateUser");
    expect(opNames).toContain("deleteUser");
    // No bulkUpsert by default
    expect(opNames).not.toContain("bulkUpsertUsers");
  });

  it("skips plugin-generated types", () => {
    const type = parseTailorDBType(
      toSchemaOutput(
        db.type("Generated", {
          name: db.string(),
        }),
      ),
    );

    const result = processType({ type, source: pluginSource });
    expect(result).toBeNull();
  });

  it("respects gqlOperations settings to disable operations", () => {
    const rawType = db
      .type("ReadOnly", {
        name: db.string(),
      })
      .features({ gqlOperations: "query" });

    const type = parseTailorDBType(toSchemaOutput(rawType));

    const result = processType({ type, source: userSource });

    expect(result).not.toBeNull();
    const opNames = result!.entries.map((e) => e.operationName);
    // Read enabled
    expect(opNames).toContain("readOnly"); // get
    expect(opNames).toContain("readOnlies"); // list (pluralized)
    // Mutations disabled
    expect(opNames).not.toContain("createReadOnly");
    expect(opNames).not.toContain("updateReadOnly");
    expect(opNames).not.toContain("deleteReadOnly");
  });

  it("includes bulkUpsert when enabled", () => {
    const rawType = db
      .type("Item", {
        name: db.string(),
      })
      .features({ bulkUpsert: true });

    const type = parseTailorDBType(toSchemaOutput(rawType));

    const result = processType({ type, source: userSource });

    expect(result).not.toBeNull();
    const opNames = result!.entries.map((e) => e.operationName);
    expect(opNames).toContain("bulkUpsertItems");
  });

  it("does not include bulkUpsert when create is disabled", () => {
    const rawType = db
      .type("Item", {
        name: db.string(),
      })
      .features({
        bulkUpsert: true,
        gqlOperations: { create: false },
      });

    const type = parseTailorDBType(toSchemaOutput(rawType));

    const result = processType({ type, source: userSource });

    expect(result).not.toBeNull();
    const opNames = result!.entries.map((e) => e.operationName);
    expect(opNames).not.toContain("bulkUpsertItems");
    expect(opNames).not.toContain("createItem");
  });

  it("uses custom pluralForm from type settings", () => {
    const rawType = db.type(["Person", "People"], {
      name: db.string(),
    });

    const type = parseTailorDBType(toSchemaOutput(rawType));

    const result = processType({ type, source: userSource });

    expect(result).not.toBeNull();
    const opNames = result!.entries.map((e) => e.operationName);
    expect(opNames).toContain("people"); // list uses custom plural
  });
});

describe("createGqlSchemaGenerator", () => {
  let generator: ReturnType<typeof createGqlSchemaGenerator>;
  const testDistPath = "./graphql-schema.d.ts";

  beforeEach(() => {
    generator = createGqlSchemaGenerator({ distPath: testDistPath });
  });

  it("has correct id and dependencies", () => {
    expect(generator.id).toBe("@tailor-platform/graphql-schema");
    expect(generator.dependencies).toEqual(["tailordb"]);
  });

  it("generates correct .d.ts output with import paths", () => {
    const type = parseTailorDBType(
      toSchemaOutput(
        db.type("Order", {
          total: db.float(),
        }),
      ),
    );

    const typeMetadata = processType({ type, source: userSource });

    const result = generator.aggregate({
      input: {
        tailordb: [
          {
            namespace: "test",
            types: { Order: typeMetadata },
          },
        ],
      },
      baseDir: "/project",
      configPath: "/project/tailor.config.ts",
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe(testDistPath);

    const content = result.files[0].content;
    expect(content).toContain('declare module "@tailor-platform/sdk/graphql"');
    expect(content).toContain("interface GeneratedGqlSchema");
    // Check import path resolution
    expect(content).toContain('(typeof import("./tailordb/user"))["user"]');
    // Check operations
    expect(content).toContain("order:");
    expect(content).toContain("orders:");
    expect(content).toContain("createOrder:");
    expect(content).toContain("updateOrder:");
    expect(content).toContain("deleteOrder:");
  });

  it("produces no files when all types are plugin-generated", () => {
    const result = generator.aggregate({
      input: {
        tailordb: [
          {
            namespace: "test",
            types: { Generated: null },
          },
        ],
      },
      baseDir: "/project",
      configPath: "/project/tailor.config.ts",
    });

    expect(result.files).toHaveLength(0);
  });

  it("resolves import paths relative to output directory", () => {
    const type = parseTailorDBType(
      toSchemaOutput(
        db.type("Item", {
          name: db.string(),
        }),
      ),
    );

    const typeMetadata = processType({ type, source: userSource });

    // Output in a subdirectory
    const result = generator.aggregate({
      input: {
        tailordb: [
          {
            namespace: "test",
            types: { Item: typeMetadata },
          },
        ],
      },
      baseDir: "/project",
      configPath: "/project/tailor.config.ts",
    });

    const content = result.files[0].content;
    // distPath is "./graphql-schema.d.ts" → outputDir is /project
    // filePath is "tailordb/user.ts" → absolute is /project/tailordb/user.ts
    // relative from /project to /project/tailordb/user = ./tailordb/user
    expect(content).toContain('(typeof import("./tailordb/user"))["user"]');
  });
});
