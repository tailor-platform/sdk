import { describe, it, expect } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { parseTypes } from "@/parser/service/tailordb";
import { processKyselyType } from "./type-processor";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

function parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name];
}

describe("Kysely TypeProcessor", () => {
  describe("basic types", () => {
    it("should handle string types", async () => {
      const type = db.type("User", {
        name: db.string(),
        nickname: db.string({ optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.name).toBe("User");
      expect(result.typeDef).toContain("name: string;");
      expect(result.typeDef).toContain("nickname: string | null;");
    });

    it("should handle number types", async () => {
      const type = db.type("Product", {
        quantity: db.int(),
        price: db.float(),
        discount: db.float({ optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("quantity: number;");
      expect(result.typeDef).toContain("price: number;");
      expect(result.typeDef).toContain("discount: number | null;");
    });

    it("should handle boolean types", async () => {
      const type = db.type("Feature", {
        enabled: db.bool(),
        beta: db.bool({ optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("enabled: boolean;");
      expect(result.typeDef).toContain("beta: boolean | null;");
    });

    it("should handle date and datetime types", async () => {
      const type = db.type("Event", {
        startDate: db.date(),
        endDate: db.datetime(),
        cancelledAt: db.datetime({ optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("startDate: Timestamp;");
      expect(result.typeDef).toContain("endDate: Timestamp;");
      expect(result.typeDef).toContain("cancelledAt: Timestamp | null;");
    });

    it("should handle uuid types", async () => {
      const type = db.type("Session", {
        userId: db.uuid(),
        deviceId: db.uuid({ optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("userId: string;");
      expect(result.typeDef).toContain("deviceId: string | null;");
    });
  });

  describe("array types", () => {
    it("should handle array fields", async () => {
      const type = db.type("Post", {
        tags: db.string({ array: true }),
        scores: db.int({ array: true, optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("tags: string[];");
      expect(result.typeDef).toContain("scores: number[] | null;");
    });
  });

  describe("enum types", () => {
    it("should handle enum types", async () => {
      const type = db.type("User", {
        role: db.enum([{ value: "admin" }, { value: "user" }]),
        status: db.enum([{ value: "active" }, { value: "inactive" }], {
          optional: true,
        }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain('role: "admin" | "user";');
      expect(result.typeDef).toContain('status: "active" | "inactive" | null;');
    });

    it("should handle enum array types", async () => {
      const type = db.type("Article", {
        categories: db.enum(["tech", "health", "finance"], { array: true }),
        authors: db.enum(["alice", "bob"], { array: true, optional: true }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain('categories: ("tech" | "health" | "finance")[];');
      expect(result.typeDef).toContain('authors: ("alice" | "bob")[] | null;');
    });
  });

  describe("nested objects", () => {
    it("should handle single level nested objects", async () => {
      const simpleNestedType = db.type("SimpleUser", {
        profile: db.object({
          name: db.string(),
          email: db.string({ optional: true }),
        }),
      });

      const result = await processKyselyType(parseTailorDBType(simpleNestedType));

      expect(result.name).toBe("SimpleUser");
      expect(result.typeDef).toContain("SimpleUser: ");
      expect(result.typeDef).toContain("profile:");
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("email: string | null");
    });

    it("should handle multi-level nested objects", async () => {
      const deepNestedType = db.type("Company", {
        details: db.object({
          // @ts-expect-error: Nested objects have complex type inference
          address: db.object({
            street: db.string(),
            city: db.string(),
            zipCode: db.string({ optional: true }),
          }),
          // @ts-expect-error: Nested objects have complex type inference
          contact: db.object({
            email: db.string(),
            phone: db.string({ optional: true }),
          }),
        }),
      });

      const result = await processKyselyType(parseTailorDBType(deepNestedType));

      expect(result.typeDef).toContain("details:");
      expect(result.typeDef).toContain("address:");
      expect(result.typeDef).toContain("street: string");
      expect(result.typeDef).toContain("city: string");
      expect(result.typeDef).toContain("zipCode: string | null");
      expect(result.typeDef).toContain("contact:");
      expect(result.typeDef).toContain("email: string");
      expect(result.typeDef).toContain("phone: string | null");
    });

    it("should handle optional nested objects", async () => {
      const type = db.type("User", {
        settings: db.object(
          {
            theme: db.string(),
            notifications: db.bool(),
          },
          { optional: true },
        ),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("settings:");
      expect(result.typeDef).toContain("| null");
    });
  });

  describe("special fields", () => {
    it("should process timestamp fields through normal field processing", async () => {
      const typeWithTimestamps = db.type("UserWithTimestamp", {
        name: db.string(),
        ...db.fields.timestamps(),
      });

      const result = await processKyselyType(parseTailorDBType(typeWithTimestamps));

      expect(result.name).toBe("UserWithTimestamp");
      expect(result.typeDef).toContain("UserWithTimestamp: {");
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("createdAt: Generated<Timestamp>;");
      expect(result.typeDef).toContain("updatedAt: Timestamp | null;");
    });

    it("should always include Generated<string> for id field", async () => {
      const type = db.type("User", {
        name: db.string(),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.typeDef).toContain("id: Generated<string>;");
    });

    it("should correctly track used utility types - basic types only", async () => {
      const type = db.type("User", {
        name: db.string(),
        age: db.int(),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.usedUtilityTypes.Timestamp).toBe(false);
      expect(result.usedUtilityTypes.Serial).toBe(false);
    });

    it("should correctly track used utility types - Timestamp", async () => {
      const type = db.type("User", {
        name: db.string(),
        ...db.fields.timestamps(),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.usedUtilityTypes.Timestamp).toBe(true);
      expect(result.usedUtilityTypes.Serial).toBe(false);
    });

    it("should correctly track used utility types - Serial", async () => {
      const type = db.type("Invoice", {
        invoiceNumber: db.string().serial({ start: 1000 }),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.usedUtilityTypes.Timestamp).toBe(false);
      expect(result.usedUtilityTypes.Serial).toBe(true);
    });

    it("should correctly track used utility types - both", async () => {
      const type = db.type("Order", {
        orderNumber: db.string().serial({ start: 1000 }),
        ...db.fields.timestamps(),
      });

      const result = await processKyselyType(parseTailorDBType(type));

      expect(result.usedUtilityTypes.Timestamp).toBe(true);
      expect(result.usedUtilityTypes.Serial).toBe(true);
    });
  });
});
