import { describe, expect, test } from "vitest";
import { SDK_BRAND, brandValue, isSdkBranded } from "./brand";

describe("brand", () => {
  describe("brandValue", () => {
    test("adds non-enumerable brand to an object", () => {
      const obj = { name: "test" };
      brandValue(obj);

      const descriptor = Object.getOwnPropertyDescriptor(obj, SDK_BRAND);
      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(false);
    });

    test("returns the same object reference (not a copy)", () => {
      const obj = { name: "test" };
      const result = brandValue(obj);

      expect(result).toBe(obj);
    });
  });

  describe("isSdkBranded", () => {
    test("returns true for branded objects", () => {
      const obj = brandValue({ name: "test" });

      expect(isSdkBranded(obj)).toBe(true);
    });

    test("returns false for plain objects", () => {
      const obj = { name: "test" };

      expect(isSdkBranded(obj)).toBe(false);
    });

    test("returns false for null/undefined/primitives", () => {
      expect(isSdkBranded(null)).toBe(false);
      expect(isSdkBranded(undefined)).toBe(false);
      expect(isSdkBranded(42)).toBe(false);
      expect(isSdkBranded("string")).toBe(false);
      expect(isSdkBranded(true)).toBe(false);
    });
  });

  describe("brand visibility", () => {
    test("brand doesn't appear in Object.keys() or JSON.stringify()", () => {
      const obj = brandValue({ name: "test", value: 42 });

      expect(Object.keys(obj)).toEqual(["name", "value"]);
      expect(JSON.stringify(obj)).toBe('{"name":"test","value":42}');
    });

    test("brand is detectable via SDK_BRAND in value", () => {
      const obj = brandValue({ name: "test" });

      expect(SDK_BRAND in obj).toBe(true);
    });
  });
});
