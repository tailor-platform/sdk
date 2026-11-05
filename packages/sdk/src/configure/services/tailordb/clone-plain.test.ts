import { cloneDeep } from "es-toolkit/object";
import { describe, expect, test } from "vitest";
import { clonePlain } from "./clone-plain";

describe("clonePlain", () => {
  test("copies nested plain objects and arrays so that mutating the copy leaves the source intact", () => {
    const source = { a: { b: [1, { c: 2 }] }, list: ["x"] };
    const copy = clonePlain(source);
    copy.a.b.push(3);
    (copy.a.b[1] as { c: number }).c = 99;
    copy.list.push("y");
    expect(source).toEqual({ a: { b: [1, { c: 2 }] }, list: ["x"] });
  });

  test("keeps function references", () => {
    const fn = () => 1;
    const copy = clonePlain({ hooks: { create: [fn] }, validate: [[fn, "msg"]] });
    expect(copy.hooks.create[0]).toBe(fn);
    expect(copy.validate[0]![0]).toBe(fn);
  });

  test("copies Date values into new instances", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const copy = clonePlain({ default: date });
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
    const copy = clonePlain(source);
    expect(copy).toBeInstanceOf(Config);
    expect(copy.inherited).toBe("from-prototype");
    expect(copy.own).not.toBe(source.own);
    expect(copy.own).toEqual({ nested: 1 });
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
    expect(clonePlain(value)).toEqual(cloneDeep(value));
  });
});
