import { describe, expect, test } from "vitest";
import { platformSerialize } from "./platform-serialize";

describe("platformSerialize", () => {
  describe("happy path", () => {
    test("round-trips plain JSON values", () => {
      expect(platformSerialize({ a: 1, b: "x", c: [true, null, { d: 2 }] })).toEqual({
        a: 1,
        b: "x",
        c: [true, null, { d: 2 }],
      });
    });

    test("returns undefined unchanged", () => {
      expect(platformSerialize(undefined)).toBeUndefined();
    });

    test("strips undefined properties (JSON.stringify semantics)", () => {
      expect(platformSerialize({ a: 1, b: undefined })).toEqual({ a: 1 });
    });
  });

  describe("Platform parity errors", () => {
    class Dto {
      constructor(public x: number) {}
    }

    test.each([
      ["NaN", { n: NaN }, /non-finite/],
      ["Infinity", { n: Infinity }, /non-finite/],
      ["BigInt", { n: 1n }, /BigInt/],
      ["Date instances", { at: new Date() }, /Date instance/],
      ["Map instances", { m: new Map() }, /Map instance/],
      ["Set instances", { s: new Set() }, /Set instance/],
      ["Error instances", { e: new Error("boom") }, /Error instance/],
      ["user-defined class instances", { d: new Dto(1) }, /Dto instance/],
    ] as const)("throws on %s", (_label, value, pattern) => {
      expect(() => platformSerialize(value)).toThrow(pattern);
    });

    test("throws on -Infinity", () => {
      expect(() => platformSerialize(-Infinity)).toThrow(/non-finite/);
    });

    test("throws on circular references via JSON.stringify", () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(() => platformSerialize(obj)).toThrow(TypeError);
    });
  });

  describe("class instance detection at top level", () => {
    test("throws when the root value is a class instance", () => {
      expect(() => platformSerialize(new Error("boom"))).toThrow(/Error instance/);
    });

    test("throws with a specific message when the root value is a function", () => {
      expect(() => platformSerialize(() => 1)).toThrow(
        /function is not JSON-serializable at <root>/,
      );
    });

    test("throws with a specific message when the root value is a symbol", () => {
      expect(() => platformSerialize(Symbol("x"))).toThrow(
        /Symbol is not JSON-serializable at <root>/,
      );
    });

    test("throws when the root collapses to undefined via toJSON", () => {
      expect(() => platformSerialize({ toJSON: () => undefined })).toThrow(
        /not JSON-serializable at <root>/,
      );
    });
  });
});
