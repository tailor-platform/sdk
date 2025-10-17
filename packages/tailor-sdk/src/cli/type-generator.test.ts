import { describe, expect, it } from "vitest";
import { generateTypeDefinition } from "./type-generator";
import type { AttributeListConfig, AttributeMapConfig } from "./type-generator";

describe("generateTypeDefinition", () => {
  it("should generate tuple type in __tuple property", () => {
    const attributeList: AttributeListConfig = ["attr1", "attr2"];

    const result = generateTypeDefinition(undefined, attributeList);

    expect(result).toContain("__tuple?: [string, string]");
  });

  it("should generate interface AttributeList for declaration merging", () => {
    const attributeMap: AttributeMapConfig = {
      role: '"MANAGER" | "STAFF"',
    };
    const attributeList: AttributeListConfig = [];

    const result = generateTypeDefinition(attributeMap, attributeList);

    // Should use interface instead of type for AttributeList
    expect(result).toContain("interface AttributeList");
    expect(result).not.toContain("type AttributeList =");
    expect(result).toContain("__tuple?: []");
  });

  it("should generate AttributeMap interface", () => {
    const attributeMap: AttributeMapConfig = {
      role: '"MANAGER" | "STAFF"',
      isActive: "boolean",
    };

    const result = generateTypeDefinition(attributeMap, undefined);

    expect(result).toContain("interface AttributeMap");
    expect(result).toContain('role: "MANAGER" | "STAFF"');
    expect(result).toContain("isActive: boolean");
  });

  it("should generate empty AttributeMap when no attributes", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface AttributeMap {}");
    expect(result).toContain("interface AttributeList");
    expect(result).toContain("__tuple?: []");
  });

  it("should include proper file header and structure", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("// This file is auto-generated");
    expect(result).toContain("declare global {");
    expect(result).toContain("namespace TailorSDK {");
    expect(result).toContain("export {};");
  });
});
