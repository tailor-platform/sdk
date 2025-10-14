import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/configure/services/tailordb/schema";

describe("Kysely TypeProcessor", () => {
  describe("basic types", () => {
    it("should handle string types", async () => {
      const type = db.type("User", {
        name: db.string(),
        nickname: db.string({ optional: true }),
      });

      const result = await TypeProcessor.processType(type);

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

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("quantity: number;");
      expect(result.typeDef).toContain("price: number;");
      expect(result.typeDef).toContain("discount: number | null;");
    });

    it("should handle boolean types", async () => {
      const type = db.type("Feature", {
        enabled: db.bool(),
        beta: db.bool({ optional: true }),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("enabled: boolean;");
      expect(result.typeDef).toContain("beta: boolean | null;");
    });

    it("should handle date and datetime types", async () => {
      const type = db.type("Event", {
        startDate: db.date(),
        endDate: db.datetime(),
        cancelledAt: db.datetime({ optional: true }),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("startDate: Timestamp;");
      expect(result.typeDef).toContain("endDate: Timestamp;");
      expect(result.typeDef).toContain("cancelledAt: Timestamp | null;");
    });

    it("should handle uuid types", async () => {
      const type = db.type("Session", {
        userId: db.uuid(),
        deviceId: db.uuid({ optional: true }),
      });

      const result = await TypeProcessor.processType(type);

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

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("tags: string[];");
      expect(result.typeDef).toContain("scores: number[] | null;");
    });
  });

  describe("enum types", () => {
    it("should handle enum types", async () => {
      const type = db.type("User", {
        role: db.enum({ value: "admin" }, { value: "user" }),
        status: db.enum(
          { value: "active" },
          { value: "inactive" },
          { optional: true },
        ),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain('role: "admin" | "user";');
      expect(result.typeDef).toContain('status: "active" | "inactive" | null;');
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

      const result = await TypeProcessor.processType(simpleNestedType);

      expect(result.name).toBe("SimpleUser");
      expect(result.typeDef).toContain("export interface SimpleUser");
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

      const result = await TypeProcessor.processType(deepNestedType);

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

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("settings:");
      expect(result.typeDef).toContain("| null");
    });
  });

  describe("special fields", () => {
    it("should handle assertNonNull field correctly", async () => {
      const typeWithAssertNonNull = db.type("UserWithAssertNonNull", {
        name: db.string(),
        email: db.string({ optional: true, assertNonNull: true }), // optional but assertNonNull
        phone: db.string({ optional: true }), // optional and nullable
      });

      const result = await TypeProcessor.processType(typeWithAssertNonNull);

      expect(result.name).toBe("UserWithAssertNonNull");
      expect(result.typeDef).toContain(
        "export interface UserWithAssertNonNull",
      );
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("email: AssertNonNull<string>"); // assertNonNull wraps the type
      expect(result.typeDef).toContain("phone: string | null"); // should be nullable
    });

    it("should process timestamp fields through normal field processing", async () => {
      const typeWithTimestamps = db.type("UserWithTimestamp", {
        name: db.string(),
        ...db.fields.timestamps(),
      });

      const result = await TypeProcessor.processType(typeWithTimestamps);

      expect(result.name).toBe("UserWithTimestamp");
      expect(result.typeDef).toContain("export interface UserWithTimestamp");
      expect(result.typeDef).toContain("name: string");
      // createdAt has assertNonNull, updatedAt doesn't
      expect(result.typeDef).toContain("createdAt: AssertNonNull<Timestamp>;");
      expect(result.typeDef).toContain("updatedAt: Timestamp | null;");
    });

    it("should handle assertNonNull with arrays", async () => {
      const type = db.type("Post", {
        tags: db.string({ array: true, optional: true, assertNonNull: true }),
        categories: db.string({ array: true, optional: true }),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("tags: AssertNonNull<string[]>;");
      expect(result.typeDef).toContain("categories: string[] | null;");
    });

    it("should handle assertNonNull with nested objects", async () => {
      const type = db.type("User", {
        profile: db.object(
          {
            name: db.string(),
            email: db.string({ optional: true }),
          },
          { optional: true, assertNonNull: true },
        ),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("profile: AssertNonNull<{");
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("email: string | null");
    });

    it("should handle assertNonNull with enum types", async () => {
      const type = db.type("User", {
        role: db.enum(
          { value: "admin" },
          { value: "user" },
          { optional: true, assertNonNull: true },
        ),
        status: db.enum(
          { value: "active" },
          { value: "inactive" },
          { optional: true },
        ),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain(
        'role: AssertNonNull<"admin" | "user">;',
      );
      expect(result.typeDef).toContain('status: "active" | "inactive" | null;');
    });

    it("should always include Generated<string> for id field", async () => {
      const type = db.type("User", {
        name: db.string(),
      });

      const result = await TypeProcessor.processType(type);

      expect(result.typeDef).toContain("id: Generated<string>;");
    });
  });
});
