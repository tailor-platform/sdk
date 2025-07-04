import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/services/tailordb/schema";

describe("Manifest TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
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
    expect(result.fields).toHaveLength(2);

    const idField = result.fields.find((f) => f.name === "id");
    expect(idField).toBeDefined();
    expect(idField?.required).toBe(true);

    const profileField = result.fields.find((f) => f.name === "profile");
    expect(profileField).toBeDefined();
    expect(profileField?.name).toBe("profile");
    expect(profileField?.required).toBe(true);

    // ネストした構造が正しく処理されているか確認
    expect((profileField as any).Fields).toBeDefined();
    expect((profileField as any).Fields.personal).toBeDefined();
    expect((profileField as any).Fields.contact).toBeDefined();

    const personalField = (profileField as any).Fields.personal;
    expect(personalField.Fields).toBeDefined();
    expect(personalField.Fields.name).toBeDefined();
    expect(personalField.Fields.name.Required).toBe(true);
    expect(personalField.Fields.age).toBeDefined();
    expect(personalField.Fields.age.Required).toBe(false);

    const contactField = (profileField as any).Fields.contact;
    expect(contactField.Fields).toBeDefined();
    expect(contactField.Fields.email).toBeDefined();
    expect(contactField.Fields.email.Required).toBe(true);
    expect(contactField.Fields.phone).toBeDefined();
    expect(contactField.Fields.phone.Required).toBe(false);
  });

  it("should handle single level nested objects", async () => {
    const simpleNestedType = db.type("SimpleUser", {
      profile: db.object({
        name: db.string(),
        email: db.string().optional(),
      }),
    });

    const result = await TypeProcessor.processType(simpleNestedType);

    expect(result.name).toBe("SimpleUser");
    expect(result.fields).toHaveLength(2);

    const idField = result.fields.find((f) => f.name === "id");
    expect(idField).toBeDefined();
    expect(idField?.required).toBe(true);

    const profileField = result.fields.find((f) => f.name === "profile");
    expect(profileField).toBeDefined();
    expect(profileField?.name).toBe("profile");
    expect(profileField?.required).toBe(true);
    expect((profileField as any).Fields).toBeDefined();
    expect((profileField as any).Fields.name).toBeDefined();
    expect((profileField as any).Fields.email).toBeDefined();
  });
});
