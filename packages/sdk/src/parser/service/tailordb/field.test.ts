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
      isValid({ value }: { value: string }): string | void {
        if (!([value].map((v) => v.includes("@"))[0] ?? false)) return "invalid email";
      },
    };
    const type = db.table("User", {
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
      [key]({ input }: { input: string | null }) {
        return input ?? "generated";
      },
    };
    const type = db.table("User", {
      email: db.string().hooks({ create: hooks[key] }),
    });

    const schema = toSchemaOutputs({ User: type });

    expect(() => parseFieldConfig(schema.User!.fields.email!)).toThrow(
      /Computed-key method shorthand/,
    );
  });

  test("throws a clear error when a validator cannot be converted to valid JavaScript", () => {
    const check = function check({ value }: { value: string }): string | void {
      if (value.length === 0) return "must not be empty";
    }.bind(null);
    const type = db.table("User", {
      email: db.string().validate(check),
    });

    const schema = toSchemaOutputs({ User: type });

    expect(() => parseFieldConfig(schema.User!.fields.email!)).toThrow(
      /Generated validate script is not valid JavaScript/,
    );
  });

  test("includes the table and field path in conversion errors from table parsing", () => {
    const check = function check({ value }: { value: string }): string | void {
      if (value.length === 0) return "must not be empty";
    }.bind(null);
    const type = db.table("User", {
      email: db.string().validate(check),
    });

    const schema = toSchemaOutputs({ User: type });

    expect(() => parseTypes(schema, "default")).toThrow(
      /Generated validate for User\.email script is not valid JavaScript/,
    );
  });
});

describe("parseFieldConfig nested inner field restrictions", () => {
  test("throws on .hooks() on nested inner fields", () => {
    const field = {
      type: "nested" as const,
      fields: {
        name: {
          type: "string" as const,
          fields: {},
          rawRelation: undefined,
          metadata: {
            hooks: {
              create: ({ input }: { input: string }) => input,
            },
          },
        },
      },
      rawRelation: undefined,
      metadata: {},
    };

    expect(() =>
      parseFieldConfig(field as never, { tableName: "Test", fieldPath: ["items", "name"] }),
    ).toThrow(".hooks() cannot be used on nested inner fields");
  });

  test("throws on .default() on nested inner fields", () => {
    const field = {
      type: "string" as const,
      fields: {},
      rawRelation: undefined,
      metadata: { default: "pending" },
    };

    expect(() =>
      parseFieldConfig(field as never, { tableName: "Test", fieldPath: ["items", "status"] }),
    ).toThrow(".default() cannot be used on nested inner fields");
  });
});

describe("parseFieldConfig enum allowed values", () => {
  const noValues = [] as unknown as ["x"];

  test.each([
    ["required", db.enum(noValues)],
    ["optional", db.enum(noValues, { optional: true })],
    ["array", db.enum(noValues, { array: true })],
    ["missing", db.enum(undefined as unknown as ["x"])],
  ])("throws when a %s enum defines no allowed values", (_label, field) => {
    const type = db.table("Task", { status: field });

    const schema = toSchemaOutputs({ Task: type });

    expect(() =>
      parseFieldConfig(schema.Task!.fields.status!, { tableName: "Task", fieldPath: ["status"] }),
    ).toThrow(
      /^Field "status" on table "Task": enum fields must define at least one allowed value$/,
    );
  });

  test("throws without a location when no context is given", () => {
    const type = db.table("Task", { status: db.enum(noValues) });

    const schema = toSchemaOutputs({ Task: type });

    expect(() => parseFieldConfig(schema.Task!.fields.status!)).toThrow(
      /^enum fields must define at least one allowed value$/,
    );
  });

  test("reports the nested path for an enum inside an object field", () => {
    const type = db.table("Task", {
      detail: db.object({ kind: db.enum(noValues) }),
    });

    const schema = toSchemaOutputs({ Task: type });

    expect(() => parseTypes(schema, "default")).toThrow(
      /^Field "detail.kind" on table "Task": enum fields must define at least one allowed value$/,
    );
  });

  test("accepts an enum with a single allowed value", () => {
    const type = db.table("Task", { status: db.enum(["open"], { optional: true }) });

    const schema = toSchemaOutputs({ Task: type });

    expect(parseFieldConfig(schema.Task!.fields.status!).allowedValues).toEqual([
      { value: "open", description: "" },
    ]);
  });
});
