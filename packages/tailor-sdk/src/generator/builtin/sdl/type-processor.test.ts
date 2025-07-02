import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { TailorDBType } from "@/services/tailordb/schema";

describe("SDL TypeProcessor", () => {
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

    const result = await TypeProcessor.processDBType(nestedObjectType);

    expect(result.name).toBe("UserProfile");
    expect(result.fields).toHaveLength(1);

    const profileField = result.fields[0];
    expect(profileField.name).toBe("profile");
    expect(profileField.required).toBe(true);

    // ネストした構造が正しく処理されているか確認
    expect(profileField.type).toContain("personal");
    expect(profileField.type).toContain("contact");
    expect(profileField.type).toContain("name: String!");
    expect(profileField.type).toContain("age: Int");
    expect(profileField.type).toContain("email: String!");
    expect(profileField.type).toContain("phone: String");
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

    const result = await TypeProcessor.processDBType(simpleNestedType);

    expect(result.name).toBe("SimpleUser");
    expect(result.fields).toHaveLength(1);

    const profileField = result.fields[0];
    expect(profileField.name).toBe("profile");
    expect(profileField.required).toBe(true);
    expect(profileField.type).toContain("name: String!");
    expect(profileField.type).toContain("email: String");
  });
});
