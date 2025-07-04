import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/services/tailordb/schema";

describe("SDL TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
    // 2段にネストしたオブジェクトのテストケース
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

    const result = await TypeProcessor.processDBType(nestedObjectType);

    expect(result.name).toBe("UserProfile");
    expect(result.fields).toHaveLength(2); // id + profile

    const profileField = result.fields.find((f) => f.name === "profile");
    expect(profileField).toBeDefined();
    expect(profileField?.name).toBe("profile");
    expect(profileField?.required).toBe(true);

    // ネストした構造が正しく処理されているか確認
    expect(profileField?.type).toContain("personal");
    expect(profileField?.type).toContain("contact");
    expect(profileField?.type).toContain("name: String!");
    expect(profileField?.type).toContain("age: Int");
    expect(profileField?.type).toContain("email: String!");
    expect(profileField?.type).toContain("phone: String");
  });

  it("should handle single level nested objects", async () => {
    const simpleNestedType = db.type("SimpleUser", {
      profile: db.object({
        name: db.string(),
        email: db.string().optional(),
      }),
    });

    const result = await TypeProcessor.processDBType(simpleNestedType);

    expect(result.name).toBe("SimpleUser");
    expect(result.fields).toHaveLength(2); // id + profile

    const profileField = result.fields.find((f) => f.name === "profile");
    expect(profileField).toBeDefined();
    expect(profileField?.name).toBe("profile");
    expect(profileField?.required).toBe(true);
    expect(profileField?.type).toContain("name: String!");
    expect(profileField?.type).toContain("email: String");
  });
});
