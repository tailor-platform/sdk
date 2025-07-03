import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import db from "@/services/tailordb/schema";

describe("Kysely TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
    // db.typeとdb.objectを使って適切なTailorDBTypeを作成
    const nestedObjectType = db.type("UserProfile", {
      profile: db.object({
        personal: db.object({
          name: db.string(),
          age: db.int().optional(),
        }),
        contact: db
          .object({
            email: db.string(),
            phone: db.string().optional(),
          })
          .optional(),
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
    // db.typeとdb.objectを使って適切なTailorDBTypeを作成
    const simpleNestedType = db.type("SimpleUser", {
      profile: db.object({
        name: db.string(),
        email: db.string().optional(),
      }),
    });

    const result = await TypeProcessor.processType(simpleNestedType);

    expect(result.name).toBe("SimpleUser");
    expect(result.typeDef).toContain("export interface SimpleUser");
    expect(result.typeDef).toContain("profile:");
    expect(result.typeDef).toContain("name: string");
    expect(result.typeDef).toContain("email: string | null");
  });
});
