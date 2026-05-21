import { describe, expect, it } from "vitest";
import { extractRecordHookOverrideKeys } from "./record-hook-keys";

describe("extractRecordHookOverrideKeys", () => {
  describe("supported shapes", () => {
    it("extracts keys from an arrow function with parenthesized object body", () => {
      const fn = (_args: { data: { name: string } }) => ({ name: "x", age: 1 });
      expect(extractRecordHookOverrideKeys(fn.toString())).toEqual(["name", "age"]);
    });

    it("extracts keys from an arrow function with block body and a single return", () => {
      const fn = (_args: { data: { name: string } }) => {
        return { name: "x", flag: true };
      };
      expect(extractRecordHookOverrideKeys(fn.toString())).toEqual(["name", "flag"]);
    });

    it("extracts keys from a function expression with a single return", () => {
      const source = `function (args) { return { foo: 1, bar: 2 }; }`;
      expect(extractRecordHookOverrideKeys(source)).toEqual(["foo", "bar"]);
    });

    it("extracts shorthand property keys", () => {
      const name = "x";
      const flag = true;
      const fn = () => ({ name, flag });
      expect(extractRecordHookOverrideKeys(fn.toString())).toEqual(["name", "flag"]);
    });

    it("extracts string-literal property keys", () => {
      const source = `() => ({ "kebab-key": 1, plain: 2 })`;
      expect(extractRecordHookOverrideKeys(source)).toEqual(["kebab-key", "plain"]);
    });

    it("treats a nested return inside an inner function as non-conditional", () => {
      // The inner arrow's return must not be counted as a branched return on the outer.
      const source = `() => { const helper = () => 1; return { a: helper() }; }`;
      expect(extractRecordHookOverrideKeys(source)).toEqual(["a"]);
    });

    it("returns an empty array when the override object literal is empty", () => {
      const source = `() => ({})`;
      expect(extractRecordHookOverrideKeys(source)).toEqual([]);
    });
  });

  describe("rejected shapes", () => {
    it("throws when spread is used inside the return literal", () => {
      const source = `(args) => ({ ...args.data, name: "x" })`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/cannot use spread/);
    });

    it("throws when computed keys are used", () => {
      const source = `(args) => ({ [args.key]: 1 })`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/cannot use computed keys/);
    });

    it("throws when the return value is not an object literal", () => {
      const source = `() => 42`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/must return an object literal/);
    });

    it("throws when an early return exists inside an if-statement (branched return)", () => {
      const source = `(args) => { if (args.flag) return { a: 1 }; return { b: 2 }; }`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(
        /single object literal at the top level/,
      );
    });

    it("throws when the value is not a function (e.g. parsing produces a non-function init)", () => {
      const source = `42`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(
        /must be a function expression or arrow function/,
      );
    });

    it("throws when a key uses a numeric literal (unsupported key type)", () => {
      const source = `() => ({ 0: "x" })`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/unsupported key type/);
    });

    it("throws on a getter property in the return literal", () => {
      const source = `() => ({ get name() { return "x"; } })`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/getter property/);
    });

    it("throws on a setter property in the return literal", () => {
      const source = `() => ({ set name(v) { /* noop */ } })`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/setter property/);
    });

    it("throws on a method-shorthand property in the return literal", () => {
      const source = `() => ({ name() { return "x"; } })`;
      expect(() => extractRecordHookOverrideKeys(source)).toThrow(/method shorthand/);
    });
  });
});
