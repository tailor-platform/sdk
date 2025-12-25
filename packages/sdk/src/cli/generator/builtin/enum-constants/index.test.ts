import { describe, it, expect, beforeEach } from "vitest";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { db } from "@/configure/services/tailordb";
import { EnumProcessor } from "./enum-processor";
import { EnumConstantsGenerator } from "./index";
import type { EnumDefinition } from "./types";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

function parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
  const service = new TailorDBService("test", { files: [] });
  service["rawTypes"]["test.ts"] = { [type.name]: type };
  service["parseTypes"]();
  return service.getTypes()[type.name];
}

describe("EnumConstantsGenerator", () => {
  let generator: EnumConstantsGenerator;
  const testDistPath = "/test/dist/enums.ts";

  beforeEach(() => {
    generator = new EnumConstantsGenerator({ distPath: testDistPath });
  });

  describe("basic properties", () => {
    it("should have correct id and description", () => {
      expect(generator.id).toBe("@tailor-platform/enum-constants");
      expect(generator.description).toBe("Generates enum constants from TailorDB type definitions");
    });

    it("should have correct dependencies", () => {
      expect(generator.dependencies).toEqual(["tailordb"]);
    });
  });

  describe("enum collection", () => {
    it("should collect top-level enum fields", async () => {
      const type = db.type("User", {
        role: db.enum(["ADMIN", "USER"]),
        status: db.enum(["ACTIVE", "INACTIVE"], { optional: true }),
      });

      const result = await EnumProcessor.processType(parseTailorDBType(type));

      expect(result.enums).toHaveLength(2);
      expect(result.enums[0].name).toBe("UserRole");
      expect(result.enums[0].values).toEqual([
        { value: "ADMIN", description: "" },
        { value: "USER", description: "" },
      ]);
      expect(result.enums[1].name).toBe("UserStatus");
      expect(result.enums[1].values).toEqual([
        { value: "ACTIVE", description: "" },
        { value: "INACTIVE", description: "" },
      ]);
    });

    it("should collect enum fields from nested objects", async () => {
      const type = db.type("PurchaseOrder", {
        attachedFiles: db.object(
          {
            id: db.uuid(),
            name: db.string(),
            type: db.enum(["text", "image"]),
          },
          { array: true },
        ),
      });

      const result = await EnumProcessor.processType(parseTailorDBType(type));

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe("PurchaseOrderAttachedFilesType");
      expect(result.enums[0].values).toEqual([
        { value: "text", description: "" },
        { value: "image", description: "" },
      ]);
    });

    it("should return empty array when no enums are present", async () => {
      const type = db.type("User", {
        name: db.string(),
        age: db.int(),
      });

      const result = await EnumProcessor.processType(parseTailorDBType(type));

      expect(result.enums).toEqual([]);
    });

    it("should collect enum values with descriptions", async () => {
      const type = db.type("Invoice", {
        status: db.enum([
          { value: "draft", description: "Draft invoice" },
          { value: "sent", description: "Sent invoice" },
          "paid",
        ]),
      });

      const result = await EnumProcessor.processType(parseTailorDBType(type));

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe("InvoiceStatus");
      expect(result.enums[0].values).toEqual([
        { value: "draft", description: "Draft invoice" },
        { value: "sent", description: "Sent invoice" },
        { value: "paid", description: "" },
      ]);
    });
  });

  describe("generateUnifiedEnumConstants", () => {
    it("should generate enum constants in as const format", () => {
      const allEnums = [
        {
          name: "UserRole",
          values: [{ value: "admin" }, { value: "user" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain("export const UserRole = {");
      expect(result).toContain('  "admin": "admin"');
      expect(result).toContain('  "user": "user"');
      expect(result).toContain("} as const;");
      expect(result).toContain("export type UserRole = (typeof UserRole)[keyof typeof UserRole];");
    });

    it("should preserve original enum values", () => {
      const allEnums = [
        {
          name: "InvoiceStatus",
          values: [{ value: "draft" }, { value: "sent" }, { value: "paid" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain('  "draft": "draft"');
      expect(result).toContain('  "sent": "sent"');
      expect(result).toContain('  "paid": "paid"');
    });

    it("should handle enum values with hyphens and spaces", () => {
      const allEnums = [
        {
          name: "OrderStatus",
          values: [{ value: "in-progress" }, { value: "ready to ship" }, { value: "delivered" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain('  "in_progress": "in-progress"');
      expect(result).toContain('  "ready_to_ship": "ready to ship"');
      expect(result).toContain('  "delivered": "delivered"');
    });

    it("should return empty string when no enums are present", () => {
      const allEnums: EnumDefinition[] = [];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toBe("");
    });

    it("should handle multiple enums", () => {
      const allEnums = [
        {
          name: "UserRole",
          values: [{ value: "admin" }, { value: "user" }],
        },
        {
          name: "InvoiceStatus",
          values: [{ value: "draft" }, { value: "sent" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain("export const UserRole = {");
      expect(result).toContain("export const InvoiceStatus = {");
    });

    it("should generate JSDoc comments for enums with descriptions", () => {
      const allEnums = [
        {
          name: "InvoiceStatus",
          values: [
            { value: "draft", description: "Draft invoice" },
            { value: "sent", description: "Sent invoice" },
            { value: "paid", description: "Paid invoice" },
          ],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain("/**");
      expect(result).toContain(" * @property draft - Draft invoice");
      expect(result).toContain(" * @property sent - Sent invoice");
      expect(result).toContain(" * @property paid - Paid invoice");
      expect(result).toContain(" */");
      expect(result).toContain("export const InvoiceStatus = {");
    });

    it("should not generate JSDoc comments when no descriptions are present", () => {
      const allEnums = [
        {
          name: "UserRole",
          values: [{ value: "admin" }, { value: "user" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).not.toContain("/**");
      expect(result).not.toContain("@property");
      expect(result).toContain("export const UserRole = {");
    });

    it("should only include @property for values with descriptions", () => {
      const allEnums = [
        {
          name: "InvoiceStatus",
          values: [
            { value: "draft", description: "Draft invoice" },
            { value: "sent" },
            { value: "paid", description: "Paid invoice" },
          ],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain("/**");
      expect(result).toContain(" * @property draft - Draft invoice");
      expect(result).toContain(" * @property sent");
      expect(result).toContain(" * @property paid - Paid invoice");
      expect(result).toContain(" */");
      expect(result).toContain("export const InvoiceStatus = {");
    });

    it("should include field description at the top of JSDoc", () => {
      const allEnums = [
        {
          name: "InvoiceStatus",
          fieldDescription: "Invoice status",
          values: [
            { value: "draft", description: "Draft invoice" },
            { value: "sent" },
            { value: "paid", description: "Paid invoice" },
          ],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain("/**");
      expect(result).toContain(" * Invoice status");
      expect(result).toContain(" *");
      expect(result).toContain(" * @property draft - Draft invoice");
      expect(result).toContain(" * @property sent");
      expect(result).toContain(" * @property paid - Paid invoice");
      expect(result).toContain(" */");
    });

    it("should only show field description when no value descriptions exist", () => {
      const allEnums = [
        {
          name: "UserRole",
          fieldDescription: "User role",
          values: [{ value: "admin" }, { value: "user" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      expect(result).toContain("/**");
      expect(result).toContain(" * User role");
      expect(result).toContain(" */");
      expect(result).not.toContain(" * @property");
    });

    it("should deduplicate enums by name", () => {
      const allEnums = [
        {
          name: "UserRole",
          values: [{ value: "admin" }, { value: "user" }],
        },
        {
          name: "UserRole", // Duplicate name
          values: [{ value: "superadmin" }],
        },
      ];

      const result = EnumProcessor.generateUnifiedEnumConstants(allEnums);

      // Should only contain one UserRole definition (the last one wins)
      const matches = result.match(/export const UserRole = {/g);
      expect(matches).toHaveLength(1);
      expect(result).toContain('  "superadmin": "superadmin"');
      expect(result).not.toContain('  "admin": "admin"');
    });
  });
});
