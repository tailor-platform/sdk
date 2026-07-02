import { parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { stringifyFunction } from "./field";

// Mirrors how consumers embed the result, e.g. `(${normalized})({ value, data, user })`.
const expectValidIife = (normalized: string, args: string) => {
  const result = parseSync("test.ts", `(${normalized})(${args})`, { sourceType: "module" });
  expect(result.errors).toEqual([]);
};

describe("stringifyFunction", () => {
  test("converts method shorthand to a function expression", () => {
    const obj = {
      create() {
        return 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function create(")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts method shorthand whose body contains an arrow function", () => {
    const obj = {
      create() {
        return [1].map((x) => x);
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function create(")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts async method shorthand", () => {
    const obj = {
      async create() {
        return 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("async function create(")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts async method shorthand whose body contains an arrow function", () => {
    const obj = {
      async create() {
        return [1].map((x) => x);
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("async function create(")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts generator method shorthand", () => {
    const obj = {
      *create() {
        yield 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function* create(")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("leaves computed-key method shorthand unchanged (no misnamed function)", () => {
    const key = "create";
    const obj = {
      [key]() {
        return 1;
      },
    };
    const result = stringifyFunction(obj[key]);
    expect(result.startsWith("[key](")).toBe(true);
  });

  test("leaves function expressions unchanged", () => {
    const obj = {
      create: function () {
        return 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("leaves arrow functions unchanged", () => {
    const create = (x: number) => x + 1;
    const result = stringifyFunction(create);
    expect(result).toBe("(x) => x + 1");
    expectValidIife(result, "1");
  });

  test("leaves async arrow functions unchanged", () => {
    const create = async (x: number) => x + 1;
    const result = stringifyFunction(create);
    expect(result).toBe("async (x) => x + 1");
    expectValidIife(result, "1");
  });
});
