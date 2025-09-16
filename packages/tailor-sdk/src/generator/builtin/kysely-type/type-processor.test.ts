import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/services/tailordb/schema";

describe("Kysely TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
    const nestedObjectType = db.type("UserProfile", {
      profile: db.object({
        personal: db.object({
          name: db.string(),
          age: db.int({ optional: true }),
        }),
        contact: db.object(
          {
            email: db.string(),
            phone: db.string({ optional: true }),
          },
          { optional: true },
        ),
      }),
    });

    const result = await TypeProcessor.processType(nestedObjectType);

    expect(result.name).toBe("UserProfile");
    expect(result.typeDef).toContain("export interface UserProfile");
    expect(result.typeDef).toContain("id: Generated<string>");

    // ネストしたオブジェクトが正しく処理されているか確認
    expect(result.typeDef).toContain("profile:");
    expect(result.typeDef).toContain("personal:");
    expect(result.typeDef).toContain("contact:");
    expect(result.typeDef).toContain("name: string");
    expect(result.typeDef).toContain("age: number | null");
    expect(result.typeDef).toContain("email: string");
    expect(result.typeDef).toContain("phone: string | null");
  });

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

  it("should handle assertNonNull field correctly", async () => {
    const typeWithAssertNonNull = db.type("UserWithAssertNonNull", {
      name: db.string(),
      email: db.string({ optional: true, assertNonNull: true }), // optional but assertNonNull
      phone: db.string({ optional: true }), // optional and nullable
    });

    const result = await TypeProcessor.processType(typeWithAssertNonNull);

    expect(result.name).toBe("UserWithAssertNonNull");
    expect(result.typeDef).toContain("export interface UserWithAssertNonNull");
    expect(result.typeDef).toContain("name: string");
    expect(result.typeDef).toContain("email: string | null"); // assertNonNull doesn't affect Kysely type generation
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
    // createdAt and updatedAt should be processed through normal field logic
    expect(result.typeDef).toContain("createdAt: Timestamp | null;");
    expect(result.typeDef).toContain("updatedAt: Timestamp | null;");
  });
});
