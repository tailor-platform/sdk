import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/configure/services/tailordb";
import { parseTypes } from "@/parser/service/tailordb";
import { generateUnifiedFileUtils } from "./generate-file-utils";
import { processFileType } from "./process-file-type";
import { createFileUtilsGenerator } from "./index";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

function parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name];
}

describe("FileUtilsGenerator", () => {
  let generator: ReturnType<typeof createFileUtilsGenerator>;
  const testDistPath = "/test/dist/files.ts";

  beforeEach(() => {
    generator = createFileUtilsGenerator({ distPath: testDistPath });
  });

  describe("basic properties", () => {
    it("should have correct id and description", () => {
      expect(generator.id).toBe("@tailor-platform/file-utils");
      expect(generator.description).toBe(
        "Generates TypeWithFiles interface from TailorDB type definitions",
      );
    });

    it("should have correct dependencies", () => {
      expect(generator.dependencies).toEqual(["tailordb"]);
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

      const result = await processFileType(parseTailorDBType(type));

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

      const result = await processFileType(parseTailorDBType(type));

      expect(result.fileFields).toEqual(["receipt", "form"]);
    });

    it("should return empty array when no files are present", async () => {
      const type = db.type("User", {
        name: db.string(),
      });

      const result = await processFileType(parseTailorDBType(type));

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

      const result = generateUnifiedFileUtils(namespaceData);

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

    it("should return empty string when no namespace data", () => {
      const result = generateUnifiedFileUtils([]);

      expect(result).toBe("");
    });

    it("should return empty string when all namespaces have no types", () => {
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
});
