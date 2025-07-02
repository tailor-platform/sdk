import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { TailorDBType } from "@/services/tailordb/schema";

describe("Manifest TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
    // 2段にネストしたオブジェクトのテストケース
    const nestedObjectType: TailorDBType = {
      name: "UserProfile",
      fields: {
        profile: {
          _metadata: {
            type: "nested",
            required: true,
          },
          fields: {
            personal: {
              _metadata: {
                type: "nested",
                required: true,
              },
              fields: {
                name: {
                  _metadata: {
                    type: "string",
                    required: true,
                  },
                },
                age: {
                  _metadata: {
                    type: "integer",
                    required: false,
                  },
                },
              },
            },
            contact: {
              _metadata: {
                type: "nested",
                required: false,
              },
              fields: {
                email: {
                  _metadata: {
                    type: "string",
                    required: true,
                  },
                },
                phone: {
                  _metadata: {
                    type: "string",
                    required: false,
                  },
                },
              },
            },
          },
        },
      },
      options: {},
      referenced: [],
      metadata: {} as any,
      hooks: {} as any,
      _output: {} as any,
    };

    const result = await TypeProcessor.processType(nestedObjectType);

    expect(result.name).toBe("UserProfile");
    expect(result.fields).toHaveLength(1);

    const profileField = result.fields[0];
    expect(profileField.name).toBe("profile");
    expect(profileField.required).toBe(true);

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
    const simpleNestedType: TailorDBType = {
      name: "SimpleUser",
      fields: {
        profile: {
          _metadata: {
            type: "nested",
            required: true,
          },
          fields: {
            name: {
              _metadata: {
                type: "string",
                required: true,
              },
            },
            email: {
              _metadata: {
                type: "string",
                required: false,
              },
            },
          },
        },
      },
      options: {},
      referenced: [],
      metadata: {} as any,
      hooks: {} as any,
      _output: {} as any,
    };

    const result = await TypeProcessor.processType(simpleNestedType);

    expect(result.name).toBe("SimpleUser");
    expect(result.fields).toHaveLength(1);

    const profileField = result.fields[0];
    expect(profileField.name).toBe("profile");
    expect(profileField.required).toBe(true);
    expect((profileField as any).Fields).toBeDefined();
    expect((profileField as any).Fields.name).toBeDefined();
    expect((profileField as any).Fields.email).toBeDefined();
  });
});
