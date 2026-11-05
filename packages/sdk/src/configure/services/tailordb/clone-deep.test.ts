import { cloneDeep as esToolkitCloneDeep } from "es-toolkit/object";
import { describe, expect, test } from "vitest";
import { cloneDeep } from "./clone-deep";

describe("cloneDeep", () => {
  test("copies nested plain objects and arrays so that mutating the copy leaves the source intact", () => {
    const source = { a: { b: [1, { c: 2 }] }, list: ["x"] };
    const copy = cloneDeep(source);
    copy.a.b.push(3);
    (copy.a.b[1] as { c: number }).c = 99;
    copy.list.push("y");
    expect(source).toEqual({ a: { b: [1, { c: 2 }] }, list: ["x"] });
  });

  test("keeps function references", () => {
    const fn = () => 1;
    const copy = cloneDeep({ hooks: { create: [fn] }, validate: [[fn, "msg"]] });
    expect(copy.hooks.create[0]).toBe(fn);
    expect(copy.validate[0]![0]).toBe(fn);
  });

  test("copies Date values into new instances", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const copy = cloneDeep({ default: date });
    expect(copy.default).not.toBe(date);
    expect(copy.default.getTime()).toBe(date.getTime());
  });

  test("keeps the prototype of class instances so inherited members survive", () => {
    class Config {
      own = { nested: 1 };
      get inherited() {
        return "from-prototype";
      }
    }
    const source = new Config();
    const copy = cloneDeep(source);
    expect(copy).toBeInstanceOf(Config);
    expect(copy.inherited).toBe("from-prototype");
    expect(copy.own).not.toBe(source.own);
    expect(copy.own).toEqual({ nested: 1 });
  });

  describe("collections and binary values", () => {
    test("copies Map keys and values deeply", () => {
      const key = { k: 1 };
      const value = { v: [1] };
      const copy = cloneDeep(new Map([[key, value]]));
      const [copiedKey, copiedValue] = [...copy][0]!;
      expect(copiedKey).toEqual(key);
      expect(copiedKey).not.toBe(key);
      expect(copiedValue).toEqual(value);
      expect(copiedValue).not.toBe(value);
    });

    test("copies Set members deeply", () => {
      const member = { m: 1 };
      const copy = cloneDeep(new Set([member, 2]));
      const [copiedMember] = [...copy];
      expect(copy.size).toBe(2);
      expect(copiedMember).toEqual(member);
      expect(copiedMember).not.toBe(member);
    });

    test("copies RegExp source, flags and lastIndex", () => {
      const source = /ab+c/gi;
      source.lastIndex = 3;
      const copy = cloneDeep(source);
      expect(copy).not.toBe(source);
      expect(copy.source).toBe("ab+c");
      expect(copy.flags).toBe("gi");
      expect(copy.lastIndex).toBe(3);
    });

    test("copies ArrayBuffer and typed arrays without sharing memory", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const copy = cloneDeep({ bytes, buffer: bytes.buffer });
      copy.bytes[0] = 9;
      expect(bytes[0]).toBe(1);
      expect(copy.buffer).not.toBe(bytes.buffer);
      expect(copy.bytes).toBeInstanceOf(Uint8Array);
    });

    test("keeps the offset and length of a DataView over part of a buffer", () => {
      const view = new DataView(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, 2, 4);
      const copy = cloneDeep(view);
      expect(copy.byteOffset).toBe(2);
      expect(copy.byteLength).toBe(4);
      expect(copy.getUint8(0)).toBe(3);
      expect(copy.buffer).not.toBe(view.buffer);
    });
  });

  describe("references", () => {
    test("rebuilds a circular reference in the copy instead of overflowing the stack", () => {
      const source: { name: string; self?: unknown } = { name: "a" };
      source.self = source;
      const copy = cloneDeep(source);
      expect(copy).not.toBe(source);
      expect(copy.self).toBe(copy);
    });

    test("keeps two references to one object pointing at a single copy", () => {
      const shared = { s: 1 };
      const copy = cloneDeep({ a: shared, b: [shared] });
      expect(copy.a).not.toBe(shared);
      expect(copy.b[0]).toBe(copy.a);
    });
  });

  describe("symbols and errors", () => {
    test("copies enumerable symbol keys deeply", () => {
      const key = Symbol("k");
      const source = { [key]: { a: 1 } };
      const copy = cloneDeep(source);
      expect(copy[key]).toEqual({ a: 1 });
      expect(copy[key]).not.toBe(source[key]);
    });

    test("copies an Error with its message, stack and cause", () => {
      const cause = new Error("root");
      const source = new TypeError("boom", { cause });
      const copy = cloneDeep(source);
      expect(copy).not.toBe(source);
      expect(copy).toBeInstanceOf(TypeError);
      expect(copy.message).toBe("boom");
      expect(copy.stack).toBe(source.stack);
      expect(copy.cause).toBeInstanceOf(Error);
      expect((copy.cause as Error).message).toBe("root");
      expect(copy.cause).not.toBe(cause);
    });
  });

  describe("unusual objects", () => {
    test("keeps holes in sparse arrays", () => {
      const sparse: number[] = [];
      sparse[0] = 1;
      sparse[2] = 3;
      const copy = cloneDeep(sparse);
      expect(copy.length).toBe(3);
      expect(1 in copy).toBe(false);
    });

    test("copies a __proto__ key from JSON as an own property without changing the prototype", () => {
      const source = JSON.parse('{"a":1,"__proto__":{"polluted":"yes"}}');
      const copy = cloneDeep(source);
      expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
      expect((copy as { polluted?: string }).polluted).toBeUndefined();
      expect(Object.keys(copy)).toEqual(["a", "__proto__"]);
    });

    test("keeps a null prototype", () => {
      const source = Object.assign(Object.create(null), { a: { b: 1 } });
      const copy = cloneDeep(source);
      expect(Object.getPrototypeOf(copy)).toBeNull();
      expect(copy.a).not.toBe(source.a);
    });

    test("deep-copies a plain object whose Symbol.toStringTag claims another type", () => {
      const source = { a: { b: 1 }, [Symbol.toStringTag]: "Map" };
      const copy = cloneDeep(source);
      expect(copy.a).toEqual({ b: 1 });
      expect(copy.a).not.toBe(source.a);
    });

    test("copies an object that shadows hasOwnProperty", () => {
      const source = { hasOwnProperty: 1, nested: { n: 1 } };
      const copy = cloneDeep(source);
      expect(copy.hasOwnProperty).toBe(1);
      expect(copy.nested).not.toBe(source.nested);
    });
  });

  test.each([
    ["primitives", 1],
    ["null", null],
    ["undefined", undefined],
    ["string", "text"],
    ["empty object", {}],
    ["empty array", []],
    [
      "field metadata",
      {
        required: false,
        array: true,
        allowedValues: [{ value: "A", description: "a" }, { value: "B" }],
        serial: { start: 1, maxValue: 10, format: "N-%05d" },
        default: { nested: [1, 2, { deep: true }], at: new Date(0) },
        description: undefined,
      },
    ],
  ])("matches es-toolkit cloneDeep for %s", (_name, value) => {
    expect(cloneDeep(value)).toEqual(esToolkitCloneDeep(value));
  });
});
