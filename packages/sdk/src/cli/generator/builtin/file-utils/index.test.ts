import { describe, it, expect, beforeEach } from "vitest";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { db } from "@/configure/services/tailordb";
import { FileProcessor } from "./file-processor";
import { FileUtilsGenerator } from "./index";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

function parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
  const service = new TailorDBService("test", { files: [] }, process.cwd());
  service["rawTypes"]["test.ts"] = { [type.name]: type };
  service["parseTypes"]();
  return service.getTypes()[type.name];
}

describe("FileUtilsGenerator", () => {
  let generator: FileUtilsGenerator;
  const testDistPath = "/test/dist/files.ts";

  beforeEach(() => {
    generator = new FileUtilsGenerator({ distPath: testDistPath });
  });

  describe("basic properties", () => {
    it("should have correct id and description", () => {
      expect(generator.id).toBe("@tailor-platform/file-utils");
      expect(generator.description).toBe(
        "Generates TypeWithFiles interface from TailorDB type definitions",
      );
    });
  });

  describe("processResolver", () => {
    it("should return undefined", () => {
      expect(generator.processResolver()).toBeUndefined();
    });
  });

  describe("processExecutor", () => {
    it("should return undefined", () => {
      expect(generator.processExecutor()).toBeUndefined();
    });
  });

  describe("file field collection", () => {
    it("should collect file field names", async () => {
      const type = db
        .type("User", {
          name: db.string(),
        })
        .files({
          avatar: "profile image",
        });

      const result = await FileProcessor.processType(parseTailorDBType(type));

      expect(result.fileFields).toEqual(["avatar"]);
    });

    it("should collect multiple file field names", async () => {
      const type = db
        .type("SalesOrder", {
          name: db.string(),
        })
        .files({
          receipt: "receipt file",
          form: "order form",
        });

      const result = await FileProcessor.processType(parseTailorDBType(type));

      expect(result.fileFields).toEqual(["receipt", "form"]);
    });

    it("should return empty array when no files are present", async () => {
      const type = db.type("User", {
        name: db.string(),
      });

      const result = await FileProcessor.processType(parseTailorDBType(type));

      expect(result.fileFields).toEqual([]);
    });
  });

  describe("generateUnifiedFileUtils", () => {
    it("should merge types from single namespace", () => {
      const namespaceData = [
        {
          namespace: "tailordb",
          types: [
            { name: "User", fileFields: ["avatar"] },
            { name: "SalesOrder", fileFields: ["receipt", "form"] },
          ],
        },
      ];

      const result = FileProcessor.generateUnifiedFileUtils(namespaceData);

      expect(result).toContain("export interface TypeWithFiles");
      expect(result).toContain("User: {");
      expect(result).toContain('fields: "avatar"');
      expect(result).toContain("SalesOrder: {");
      expect(result).toContain('"receipt" | "form"');
      expect(result).toContain('User: "tailordb"');
      expect(result).toContain('SalesOrder: "tailordb"');
    });

    it("should merge types from multiple namespaces", () => {
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

      const result = FileProcessor.generateUnifiedFileUtils(namespaceData);

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

    it("should return empty string when no namespace data", () => {
      const result = FileProcessor.generateUnifiedFileUtils([]);

      expect(result).toBe("");
    });

    it("should return empty string when all namespaces have no types", () => {
      const namespaceData = [
        {
          namespace: "tailordb",
          types: [],
        },
      ];

      const result = FileProcessor.generateUnifiedFileUtils(namespaceData);

      expect(result).toBe("");
    });
  });
});
