import { describe, expect, test } from "vitest";
import { SDK_BRAND, brandValue, isSdkBranded } from "./brand";

describe("brand", () => {
  describe("brandValue", () => {
    test("adds non-enumerable brand to an object", () => {
      const obj = { name: "test" };
      brandValue(obj, "tailordb-type");

      const descriptor = Object.getOwnPropertyDescriptor(obj, SDK_BRAND);
      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(false);
    });

    test("stores the kind as the brand value", () => {
      const obj = { name: "test" };
      brandValue(obj, "executor");

      const descriptor = Object.getOwnPropertyDescriptor(obj, SDK_BRAND);
      expect(descriptor?.value).toBe("executor");
    });

    test("returns the same object reference (not a copy)", () => {
      const obj = { name: "test" };
      const result = brandValue(obj, "resolver");

      expect(result).toBe(obj);
    });
  });

  describe("isSdkBranded", () => {
    test("returns true for branded objects without kind filter", () => {
      const obj = brandValue({ name: "test" }, "tailordb-type");

      expect(isSdkBranded(obj)).toBe(true);
    });

    test.each([
      ["executor", "executor", true],
      ["executor", "tailordb-type", false],
      ["workflow", ["workflow", "workflow-job"], true],
      ["executor", ["workflow", "workflow-job"], false],
    ] as const)("branded as %s, filtered by %j => %s", (brandKind, filterKind, expected) => {
      const obj = brandValue({ name: "test" }, brandKind);

      expect(isSdkBranded(obj, filterKind)).toBe(expected);
    });

    test("returns false for plain objects", () => {
      const obj = { name: "test" };

      expect(isSdkBranded(obj)).toBe(false);
    });

    test("returns true for legacy boolean brand with any kind filter", () => {
      const obj = { name: "test" };
      Object.defineProperty(obj, SDK_BRAND, { value: true, enumerable: false });

      expect(isSdkBranded(obj, "executor")).toBe(true);
      expect(isSdkBranded(obj, "tailordb-type")).toBe(true);
    });

    test.each([null, undefined, 42, "string", true])(
      "returns false for non-object value %s",
      (value) => {
        expect(isSdkBranded(value)).toBe(false);
      },
    );
  });

  describe("brand visibility", () => {
    test("brand doesn't appear in Object.keys() or JSON.stringify()", () => {
      const obj = brandValue({ name: "test", value: 42 }, "tailordb-type");

      expect(Object.keys(obj)).toEqual(["name", "value"]);
      expect(JSON.stringify(obj)).toBe('{"name":"test","value":42}');
    });

    test("brand is detectable via SDK_BRAND in value", () => {
      const obj = brandValue({ name: "test" }, "workflow");

      expect(SDK_BRAND in obj).toBe(true);
    });
  });
});
