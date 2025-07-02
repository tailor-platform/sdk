import { describe, it, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { TailorDBType } from "@/services/tailordb/schema";

describe("Kysely TypeProcessor", () => {
  it("should process deeply nested objects correctly", async () => {
    // 2段にネストしたオブジェクトのテストケース
    const nestedObjectType: TailorDBType = {
      name: "UserProfile",
      fields: {
        profile: {
          metadata: {
            type: "nested",
            required: true,
          },
          fields: {
            personal: {
              metadata: {
                type: "nested",
                required: true,
              },
              fields: {
                name: {
                  metadata: {
                    type: "string",
                    required: true,
                  },
                },
                age: {
                  metadata: {
                    type: "integer",
                    required: false,
                  },
                },
              },
            },
            contact: {
              metadata: {
                type: "nested",
                required: false,
              },
              fields: {
                email: {
                  metadata: {
                    type: "string",
                    required: true,
                  },
                },
                phone: {
                  metadata: {
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
    const simpleNestedType: TailorDBType = {
      name: "SimpleUser",
      fields: {
        profile: {
          metadata: {
            type: "nested",
            required: true,
          },
          fields: {
            name: {
              metadata: {
                type: "string",
                required: true,
              },
            },
            email: {
              metadata: {
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
    expect(result.typeDef).toContain("export interface SimpleUser");
    expect(result.typeDef).toContain("profile:");
    expect(result.typeDef).toContain("name: string");
    expect(result.typeDef).toContain("email: string | null");
  });
});
