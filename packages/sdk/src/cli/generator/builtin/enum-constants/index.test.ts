import { describe, it, expect, beforeEach } from "vitest";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { db } from "@/configure/services/tailordb";
import { EnumProcessor } from "./enum-processor";
import { EnumConstantsGenerator } from "./index";
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
      expect(generator.description).toBe(
        "Generates enum constants from TailorDB type definitions",
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

  describe("enum collection", () => {
    it("should collect top-level enum fields", async () => {
      const type = db.type("User", {
        role: db.enum("ADMIN", "USER"),
        status: db.enum("ACTIVE", "INACTIVE", { optional: true }),
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
            type: db.enum("text", "image"),
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
        status: db.enum(
          { value: "draft", description: "Draft invoice" },
          { value: "sent", description: "Sent invoice" },
          "paid",
        ),
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
});
