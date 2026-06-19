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
    test("throws on NaN", () => {
      expect(() => platformSerialize({ n: NaN })).toThrow(/non-finite/);
    });

    test("throws on Infinity", () => {
      expect(() => platformSerialize({ n: Infinity })).toThrow(/non-finite/);
    });

    test("throws on -Infinity", () => {
      expect(() => platformSerialize(-Infinity)).toThrow(/non-finite/);
    });

    test("throws on BigInt", () => {
      expect(() => platformSerialize({ n: 1n })).toThrow(/BigInt/);
    });

    test("throws on Date instances", () => {
      expect(() => platformSerialize({ at: new Date() })).toThrow(/Date instance/);
    });

    test("throws on Map instances", () => {
      expect(() => platformSerialize({ m: new Map() })).toThrow(/Map instance/);
    });

    test("throws on Set instances", () => {
      expect(() => platformSerialize({ s: new Set() })).toThrow(/Set instance/);
    });

    test("throws on Error instances", () => {
      expect(() => platformSerialize({ e: new Error("boom") })).toThrow(/Error instance/);
    });

    test("throws on user-defined class instances", () => {
      class Dto {
        constructor(public x: number) {}
      }
      expect(() => platformSerialize({ d: new Dto(1) })).toThrow(/Dto instance/);
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
