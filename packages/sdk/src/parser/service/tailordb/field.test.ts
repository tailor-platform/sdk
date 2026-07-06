import { parseSync } from "oxc-parser";
import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { toSchemaOutputs } from "#/utils/test/internal";
import { parseFieldConfig, stringifyFunction } from "./field";
import { parseTypes } from "./type-parser";

// Mirrors how consumers embed the result, e.g. `(${normalized})({ value, data, user })`.
const expectValidIife = (normalized: string, args: string) => {
  const result = parseSync("test.ts", `(${normalized})(${args})`, { sourceType: "module" });
  expect(result.errors).toEqual([]);
};

describe("stringifyFunction", () => {
  test("converts method shorthand to an anonymous function expression", () => {
    const obj = {
      create() {
        return 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function (")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts method shorthand whose body contains an arrow function", () => {
    const obj = {
      create() {
        return [1].map((x) => x);
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function (")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts async method shorthand", () => {
    const obj = {
      async create() {
        return 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("async function (")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts async method shorthand whose body contains an arrow function", () => {
    const obj = {
      async create() {
        return [1].map((x) => x);
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("async function (")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("converts generator method shorthand", () => {
    const obj = {
      *create() {
        yield 1;
      },
    };
    const result = stringifyFunction(obj.create);
    expect(result.startsWith("function* (")).toBe(true);
    expectValidIife(result, "{}");
  });

  test("does not shadow an outer variable that shares the method's name", () => {
    const create = (v: number) => v * 100;
    const obj = {
      // `new Function("create", ...)` below re-supplies `create` as a free
      // variable at call time; this local `create` only satisfies the type
      // checker for the reference inside the method body.
      create({ value }: { value: number }) {
        return [value].map((v) => create(v))[0];
      },
    };
    const result = stringifyFunction(obj.create);
    const fn = new Function("create", `return (${result})`)(create) as (args: {
      value: number;
    }) => number;
    expect(fn({ value: 1 })).toBe(100);
  });

  test("rejects computed-key method shorthand with a specific error", () => {
    const key = "create";
    const obj = {
      [key]() {
        return 1;
      },
    };
    expect(() => stringifyFunction(obj[key])).toThrow(/Computed-key method shorthand/);
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

describe("parseFieldConfig validator expressions", () => {
  test("normalizes a method-shorthand validator whose body contains an arrow function", () => {
    // Method shorthand syntax, obtained the same way a user's helper object would produce it.
    const validators = {
      isValid({ newValue }: { newValue: string; oldValue: string | null }): string | void {
        if (!([newValue].map((v) => v.includes("@"))[0] ?? false)) return "invalid email";
      },
    };
    const type = db.type("User", {
      email: db.string().validate(validators.isValid),
    });

    const schema = toSchemaOutputs({ User: type });
    const field = parseFieldConfig(schema.User!.fields.email!);
    const expr = field.validate?.[0]?.script.expr;
    expect(expr).toBeDefined();

    const result = parseSync("test.ts", expr!, { sourceType: "module" });
    expect(result.errors).toEqual([]);
  });
});

describe("parseFieldConfig script expression validation", () => {
  test("throws a clear error when a hook cannot be converted to valid JavaScript", () => {
    const key = "create";
    const hooks = {
      [key]({ value }: { value: string | null }) {
        return value ?? "generated";
      },
    };
    const type = db.type("User", {
      email: db.string().hooks({ create: hooks[key] }),
    });

    const schema = toSchemaOutputs({ User: type });

    expect(() => parseFieldConfig(schema.User!.fields.email!)).toThrow(
      /Computed-key method shorthand/,
    );
  });

  test("throws a clear error when a validator cannot be converted to valid JavaScript", () => {
    const check = function check({
      newValue,
    }: {
      newValue: string;
      oldValue: string | null;
    }): string | void {
      if (newValue.length === 0) return "must not be empty";
    }.bind(null);
    const type = db.type("User", {
      email: db.string().validate(check),
    });

    const schema = toSchemaOutputs({ User: type });

    expect(() => parseFieldConfig(schema.User!.fields.email!)).toThrow(
      /Generated validate script is not valid JavaScript/,
    );
  });

  test("includes the type and field path in conversion errors from type parsing", () => {
    const check = function check({
      newValue,
    }: {
      newValue: string;
      oldValue: string | null;
    }): string | void {
      if (newValue.length === 0) return "must not be empty";
    }.bind(null);
    const type = db.type("User", {
      email: db.string().validate(check),
    });

    const schema = toSchemaOutputs({ User: type });

    expect(() => parseTypes(schema, "default")).toThrow(
      /Generated validate for User\.email script is not valid JavaScript/,
    );
  });
});
