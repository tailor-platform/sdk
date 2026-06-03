import { describe, expect, it } from "vitest";
import { platformSerialize } from "./platform-serialize";

describe("platformSerialize", () => {
  describe("happy path", () => {
    it("round-trips plain JSON values", () => {
      expect(platformSerialize({ a: 1, b: "x", c: [true, null, { d: 2 }] })).toEqual({
        a: 1,
        b: "x",
        c: [true, null, { d: 2 }],
      });
    });

    it("returns undefined unchanged", () => {
      expect(platformSerialize(undefined)).toBeUndefined();
    });

    it("strips undefined properties (JSON.stringify semantics)", () => {
      expect(platformSerialize({ a: 1, b: undefined })).toEqual({ a: 1 });
    });
  });

  describe("Platform parity errors", () => {
    it("throws on NaN", () => {
      expect(() => platformSerialize({ n: NaN })).toThrow(/non-finite/);
    });

    it("throws on Infinity", () => {
      expect(() => platformSerialize({ n: Infinity })).toThrow(/non-finite/);
    });

    it("throws on -Infinity", () => {
      expect(() => platformSerialize(-Infinity)).toThrow(/non-finite/);
    });

    it("throws on BigInt", () => {
      expect(() => platformSerialize({ n: 1n })).toThrow(/BigInt/);
    });

    it("throws on Date instances", () => {
      expect(() => platformSerialize({ at: new Date() })).toThrow(/Date instance/);
    });

    it("throws on Map instances", () => {
      expect(() => platformSerialize({ m: new Map() })).toThrow(/Map instance/);
    });

    it("throws on Set instances", () => {
      expect(() => platformSerialize({ s: new Set() })).toThrow(/Set instance/);
    });

    it("throws on Error instances", () => {
      expect(() => platformSerialize({ e: new Error("boom") })).toThrow(/Error instance/);
    });

    it("throws on user-defined class instances", () => {
      class Dto {
        constructor(public x: number) {}
      }
      expect(() => platformSerialize({ d: new Dto(1) })).toThrow(/Dto instance/);
    });

    it("throws on circular references via JSON.stringify", () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(() => platformSerialize(obj)).toThrow(TypeError);
    });
  });

  describe("class instance detection at top level", () => {
    it("throws when the root value is a class instance", () => {
      expect(() => platformSerialize(new Error("boom"))).toThrow(/Error instance/);
    });

    it("throws with a specific message when the root value is a function", () => {
      expect(() => platformSerialize(() => 1)).toThrow(
        /function is not JSON-serializable at <root>/,
      );
    });

    it("throws with a specific message when the root value is a symbol", () => {
      expect(() => platformSerialize(Symbol("x"))).toThrow(
        /Symbol is not JSON-serializable at <root>/,
      );
    });
  });
});
