import { describe, expect, test } from "vitest";
import { db } from "@/configure/services/tailordb";
import { parseTypes } from "@/parser/service/tailordb";
import { toSchemaOutput } from "@/utils/test/internal";
import { generateUnifiedFileUtils } from "./generate-file-utils";
import { processFileType } from "./process-file-type";
import { fileUtilsPlugin, FileUtilsGeneratorID } from "./index";
import type { TailorDBType } from "@/parser/service/tailordb/types";
import type { TailorDBReadyContext } from "@/plugin/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "@/types/tailordb.generated";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name];
}

describe("FileUtilsPlugin", () => {
  const testDistPath = "/test/dist/files.ts";

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

  describe("basic properties", () => {
    test("should have correct id and description", () => {
      const plugin = fileUtilsPlugin({ distPath: testDistPath });
      expect(plugin.id).toBe(FileUtilsGeneratorID);
      expect(plugin.description).toBe(
        "Generates TypeWithFiles interface from TailorDB type definitions",
      );
    });
  });

  describe("file field collection", () => {
    test("should collect file field names", async () => {
      const type = db
        .type("User", {
          name: db.string(),
        })
        .files({
          avatar: "profile image",
        });

      const result = await processFileType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.fileFields).toEqual(["avatar"]);
    });

    test("should collect multiple file field names", async () => {
      const type = db
        .type("SalesOrder", {
          name: db.string(),
        })
        .files({
          receipt: "receipt file",
          form: "order form",
        });

      const result = await processFileType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.fileFields).toEqual(["receipt", "form"]);
    });

    test("should return empty array when no files are present", async () => {
      const type = db.type("User", {
        name: db.string(),
      });

      const result = await processFileType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.fileFields).toEqual([]);
    });
  });

  describe("generateUnifiedFileUtils", () => {
    test("should merge types from single namespace", () => {
      const namespaceData = [
        {
          namespace: "tailordb",
          types: [
            { name: "User", fileFields: ["avatar"] },
            { name: "SalesOrder", fileFields: ["receipt", "form"] },
          ],
        },
      ];

      const result = generateUnifiedFileUtils(namespaceData);

      expect(result).toContain("export interface TypeWithFiles");
      expect(result).toContain("User: {");
      expect(result).toContain('fields: "avatar"');
      expect(result).toContain("SalesOrder: {");
      expect(result).toContain('"receipt" | "form"');
      expect(result).toContain('User: "tailordb"');
      expect(result).toContain('SalesOrder: "tailordb"');
    });

    test("should merge types from multiple namespaces", () => {
      const namespaceData = [
        {
          namespace: "tailordb",
          types: [
            { name: "User", fileFields: ["avatar"] },
            { name: "SalesOrder", fileFields: ["receipt", "form"] },
          ],
        },
        {
          namespace: "someNamespace",
          types: [{ name: "Customer", fileFields: ["document"] }],
        },
      ];

      const result = generateUnifiedFileUtils(namespaceData);

      expect(result).toContain("export interface TypeWithFiles");
      expect(result).toContain("User: {");
      expect(result).toContain('fields: "avatar"');
      expect(result).toContain("SalesOrder: {");
      expect(result).toContain('"receipt" | "form"');
      expect(result).toContain("Customer: {");
      expect(result).toContain('fields: "document"');
      expect(result).toContain('User: "tailordb"');
      expect(result).toContain('SalesOrder: "tailordb"');
      expect(result).toContain('Customer: "someNamespace"');
    });

    test("should return empty string when no namespace data", () => {
      const result = generateUnifiedFileUtils([]);

      expect(result).toBe("");
    });

    test("should return empty string when all namespaces have no types", () => {
      const namespaceData = [
        {
          namespace: "tailordb",
          types: [],
        },
      ];

      const result = generateUnifiedFileUtils(namespaceData);

      expect(result).toBe("");
    });
  });

  describe("onTailorDBReady integration", () => {
    test("should generate file utils for types with file fields", async () => {
      const userType = db
        .type("User", {
          name: db.string(),
        })
        .files({
          avatar: "profile image",
        });

      const salesOrderType = db
        .type("SalesOrder", {
          name: db.string(),
        })
        .files({
          receipt: "receipt file",
          form: "order form",
        });

      const ctx = createCtx([
        {
          namespace: "tailordb",
          types: {
            User: parseTailorDBType(toSchemaOutput(userType)),
            SalesOrder: parseTailorDBType(toSchemaOutput(salesOrderType)),
          },
        },
      ]);

      const plugin = fileUtilsPlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(testDistPath);

      const content = result.files[0].content;
      expect(content).toContain("export interface TypeWithFiles");
      expect(content).toContain("User: {");
      expect(content).toContain("SalesOrder: {");
    });

    test("should return empty files when no types have file fields", async () => {
      const userType = db.type("User", {
        name: db.string(),
      });

      const ctx = createCtx([
        {
          namespace: "tailordb",
          types: {
            User: parseTailorDBType(toSchemaOutput(userType)),
          },
        },
      ]);

      const plugin = fileUtilsPlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      expect(result.files).toHaveLength(0);
    });

    test("should handle multiple namespaces", async () => {
      const userType = db
        .type("User", {
          name: db.string(),
        })
        .files({
          avatar: "profile image",
        });

      const customerType = db
        .type("Customer", {
          name: db.string(),
        })
        .files({
          document: "customer document",
        });

      const ctx = createCtx([
        {
          namespace: "tailordb",
          types: { User: parseTailorDBType(toSchemaOutput(userType)) },
        },
        {
          namespace: "someNamespace",
          types: { Customer: parseTailorDBType(toSchemaOutput(customerType)) },
        },
      ]);

      const plugin = fileUtilsPlugin({ distPath: testDistPath });
      const result = await plugin.onTailorDBReady!(ctx);

      expect(result.files).toHaveLength(1);
      const content = result.files[0].content;
      expect(content).toContain("User: {");
      expect(content).toContain("Customer: {");
      expect(content).toContain('User: "tailordb"');
      expect(content).toContain('Customer: "someNamespace"');
    });
  });
});
