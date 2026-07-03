// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expect, test, expectTypeOf } from "vitest";
import { t } from "./type";
import type { TailorPrincipal } from "#/runtime/types";
import type { output } from "#/types/helpers";
import type { AllowedValues } from "./field";
import type { DateString, DateTimeString, TimeString, UUIDString } from "./scalar.types";

const invoker: TailorPrincipal = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  type: "user",
  workspaceId: "workspace-test",
  attributes: {},
  attributeList: [],
};
const data = {};

function expectParsed<V>(result: { issues?: unknown; value?: V }): V {
  expect(result.issues).toBeUndefined();
  if (result.issues) {
    throw new Error("Unexpected issues");
  }
  return result.value as V;
}

describe("TailorType basic field type tests", () => {
  test("string field outputs string type correctly", () => {
    const _stringType = t.object({
      name: t.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  test("int field outputs number type correctly", () => {
    const _intType = t.object({
      age: t.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      age: number;
    }>();
  });

  test("bool field outputs boolean type correctly", () => {
    const _boolType = t.object({
      active: t.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      active: boolean;
    }>();
  });

  test("float field outputs number type correctly", () => {
    const _floatType = t.object({
      price: t.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      price: number;
    }>();
  });

  test("uuid field outputs UUID string type correctly", () => {
    const _uuidType = t.object({
      id: t.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: UUIDString;
    }>();
  });

  test("date field outputs date string type correctly", () => {
    const _dateType = t.object({
      birthDate: t.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      birthDate: DateString;
    }>();
  });

  test("datetime field outputs datetime string | Date type correctly", () => {
    const _datetimeType = t.object({
      createdAt: t.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toEqualTypeOf<{
      createdAt: DateTimeString | Date;
    }>();
  });

  test("time field outputs time string type correctly", () => {
    const _timeType = t.object({
      openingTime: t.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      openingTime: TimeString;
    }>();
  });
});

describe("TailorField optional option tests", () => {
  test("optional option generates nullable type", () => {
    const _optionalType = t.object({
      description: t.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      description?: string | null;
    }>();
  });

  test("multiple optional fields work correctly", () => {
    const _multiOptionalType = t.object({
      title: t.string(),
      description: t.string({ optional: true }),
      count: t.int({ optional: true }),
    });
    expectTypeOf<output<typeof _multiOptionalType>>().toEqualTypeOf<{
      title: string;
      description?: string | null;
      count?: number | null;
    }>();
  });
});

describe("TailorField array option tests", () => {
  test("array option generates array type", () => {
    const _arrayType = t.object({
      tags: t.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      tags: string[];
    }>();
  });

  test("optional array works correctly", () => {
    const _optionalArrayType = t.object({
      items: t.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      items?: string[] | null;
    }>();
  });

  test("multiple array fields work correctly", () => {
    const _multiArrayType = t.object({
      tags: t.string({ array: true }),
      numbers: t.int({ array: true }),
      flags: t.bool({ array: true }),
    });
    expectTypeOf<output<typeof _multiArrayType>>().toEqualTypeOf<{
      tags: string[];
      numbers: number[];
      flags: boolean[];
    }>();
  });
});

describe("TailorField enum field tests", () => {
  test.each([
    {
      name: "set enum field by passing string",
      values: ["active", "inactive", "pending"] as const,
      expected: [
        { value: "active", description: "" },
        { value: "inactive", description: "" },
        { value: "pending", description: "" },
      ],
    },
    {
      name: "set enum field by passing object",
      values: [
        { value: "small", description: "Small size" },
        { value: "medium" },
        { value: "large", description: "Large size" },
      ] as const,
      expected: [
        { value: "small", description: "Small size" },
        { value: "medium", description: "" },
        { value: "large", description: "Large size" },
      ],
    },
    {
      name: "set enum field by mixing string and object",
      values: ["red", { value: "green", description: "Green color" }, "blue"] as const,
      expected: [
        { value: "red", description: "" },
        { value: "green", description: "Green color" },
        { value: "blue", description: "" },
      ],
    },
    {
      name: "accepts as const readonly array",
      values: ["active", "inactive", "pending"] as const,
      expected: [
        { value: "active", description: "" },
        { value: "inactive", description: "" },
        { value: "pending", description: "" },
      ],
    },
  ])("$name", ({ values, expected }) => {
    const enumField = t.enum(values);
    expect(enumField.metadata.allowedValues).toEqual(expected);
  });

  test("set enum field by passing string infers a string literal union", () => {
    const enumField = t.enum(["active", "inactive", "pending"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"active" | "inactive" | "pending">();
  });

  test("set enum field by passing object infers a string literal union", () => {
    const enumField = t.enum([
      { value: "small", description: "Small size" },
      { value: "medium" },
      { value: "large", description: "Large size" },
    ]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"small" | "medium" | "large">();
  });

  test("set enum field by mixing string and object infers a string literal union", () => {
    const enumField = t.enum(["red", { value: "green", description: "Green color" }, "blue"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"red" | "green" | "blue">();
  });

  test("accepts as const readonly array and infers a string literal union", () => {
    const STATUSES = ["active", "inactive", "pending"] as const;
    const enumField = t.enum(STATUSES);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"active" | "inactive" | "pending">();
  });

  test("setting enum without values causes type error", () => {
    // @ts-expect-error AllowedValues requires at least one value
    t.enum([]);
    // @ts-expect-error AllowedValues requires at least one value
    t.enum([], { optional: true });
  });

  test("optional enum() works correctly", () => {
    const _optionalEnumType = t.object({
      priority: t.enum(["high", "medium", "low"], { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  test("AllowedValues type accepts readonly arrays", () => {
    const STATUSES = ["active", "inactive"] as const;
    const _values: AllowedValues = STATUSES;
    expect(_values).toEqual(STATUSES);
  });

  test("enum array works correctly", () => {
    const _enumArrayType = t.object({
      categories: t.enum(["a", "b", "c"], { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorType composite type tests", () => {
  test("type with multiple fields works correctly", () => {
    const _complexType = t.object({
      id: t.uuid(),
      name: t.string(),
      email: t.string(),
      age: t.int({ optional: true }),
      isActive: t.bool(),
      tags: t.string({ array: true }),
      role: t.enum(["admin", "user", "guest"]),
    });
    expectTypeOf<output<typeof _complexType>>().toEqualTypeOf<{
      id: UUIDString;
      name: string;
      email: string;
      age?: number | null;
      isActive: boolean;
      tags: string[];
      role: "admin" | "user" | "guest";
    }>();
  });
});

describe("TailorType edge case tests", () => {
  test("type with single field works correctly", () => {
    const _singleFieldType = t.object({
      value: t.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      value: string;
    }>();
  });

  test("type with all optional fields works correctly", () => {
    const _allOptionalType = t.object({
      a: t.string({ optional: true }),
      b: t.int({ optional: true }),
      c: t.bool({ optional: true }),
    });
    expectTypeOf<output<typeof _allOptionalType>>().toEqualTypeOf<{
      a?: string | null;
      b?: number | null;
      c?: boolean | null;
    }>();
  });

  test("type with all array fields works correctly", () => {
    const _allArrayType = t.object({
      strings: t.string({ array: true }),
      numbers: t.int({ array: true }),
      booleans: t.bool({ array: true }),
    });
    expectTypeOf<output<typeof _allArrayType>>().toEqualTypeOf<{
      strings: string[];
      numbers: number[];
      booleans: boolean[];
    }>();
  });
});

describe("TailorType type consistency tests", () => {
  test("same definition generates same type", () => {
    const _type1 = t.object({
      name: t.string(),
      age: t.int(),
    });
    const _type2 = t.object({
      name: t.string(),
      age: t.int(),
    });
    expectTypeOf<output<typeof _type1>>().toEqualTypeOf<output<typeof _type2>>();
  });
});

describe("t.object tests", () => {
  test("correctly infers basic object type", () => {
    const _objectType = t.object({
      user: t.object({
        name: t.string(),
        age: t.int(),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      user: {
        name: string;
        age: number;
      };
    }>();
  });

  test("correctly infers object type with optional fields", () => {
    const _objectType = t.object({
      profile: t.object({
        name: t.string(),
        age: t.int({ optional: true }),
        email: t.string({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      profile: {
        name: string;
        age?: number | null;
        email?: string | null;
      };
    }>();
  });

  test("correctly infers object type with array fields", () => {
    const _objectType = t.object({
      data: t.object({
        name: t.string(),
        tags: t.string({ array: true }),
        scores: t.int({ optional: true, array: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      data: {
        name: string;
        tags: string[];
        scores?: number[] | null;
      };
    }>();
  });

  test("correctly infers nested object type", () => {
    const _objectType = t.object({
      user: t.object({
        name: t.string(),
        address: t.object({
          street: t.string(),
          city: t.string(),
          zipCode: t.string({ optional: true }),
        }),
        contacts: t.object(
          {
            email: t.string(),
            phone: t.string({ optional: true }),
          },
          { optional: true },
        ),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      user: {
        name: string;
        address: {
          street: string;
          city: string;
          zipCode?: string | null;
        };
        contacts?: {
          email: string;
          phone?: string | null;
        } | null;
      };
    }>();
  });

  test("correctly infers object type with optional option", () => {
    const _objectType = t.object({
      metadata: t.object(
        {
          version: t.string(),
          author: t.string(),
        },
        { optional: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      metadata?: {
        version: string;
        author: string;
      } | null;
    }>();
  });

  test("correctly infers object type with array option", () => {
    const _objectType = t.object({
      items: t.object(
        {
          id: t.uuid(),
          name: t.string(),
        },
        { array: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      items: {
        id: UUIDString;
        name: string;
      }[];
    }>();
  });

  test("correctly infers object type with multiple modifiers", () => {
    const _objectType = t.object({
      optionalItems: t.object(
        {
          id: t.uuid(),
          value: t.string({ optional: true }),
        },
        { optional: true, array: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      optionalItems?:
        | {
            id: UUIDString;
            value?: string | null;
          }[]
        | null;
    }>();
  });

  test("correctly infers object type with enum type", () => {
    const _objectType = t.object({
      config: t.object({
        name: t.string(),
        status: t.enum(["active", "inactive"]),
        priority: t.enum(["high", "medium", "low"], { optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      config: {
        name: string;
        status: "active" | "inactive";
        priority?: "high" | "medium" | "low" | null;
      };
    }>();
  });

  test("correctly infers object type with single field", () => {
    const _objectType = t.object({
      settings: t.object({
        theme: t.string(),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      settings: {
        theme: string;
      };
    }>();
  });

  test("correctly infers empty object", () => {
    const _objectType = t.object({
      empty: t.object({}),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      empty: {};
    }>();
  });
});

describe("TailorField runtime validation tests", () => {
  describe("validates primitive types", () => {
    test("validates string type", () => {
      const ok = t.string().parse({ value: "valid string", data, invoker });
      expect(expectParsed(ok)).toBe("valid string");

      const bad = t.string().parse({ value: 123, data, invoker });
      expect(bad.issues).toBeDefined();
      expect(bad.issues?.[0]?.message).toEqual("Expected a string: received 123");
      expect(bad.issues?.[0]?.path).toBeUndefined();
    });

    test.each([
      { value: "invalid string", message: "Expected an integer: received invalid string" },
      { value: 1.5, message: "Expected an integer: received 1.5" },
    ])("validates integer type - rejects $value", ({ value, message }) => {
      const result = t.int().parse({ value, data, invoker });
      expect(result.issues).toBeDefined();
      expect(result.issues?.[0]?.message).toEqual(message);
    });

    test("validates integer type - accepts a valid integer", () => {
      const result = t.int().parse({ value: 123, data, invoker });
      expect(expectParsed(result)).toBe(123);
    });

    test.each([
      { value: Number.NaN, message: "Expected a number: received NaN" },
      { value: "invalid string", message: "Expected a number: received invalid string" },
    ])("validates float type - rejects $value", ({ value, message }) => {
      const result = t.float().parse({ value, data, invoker });
      expect(result.issues).toBeDefined();
      expect(result.issues?.[0]?.message).toEqual(message);
    });

    test("validates float type - accepts a valid float", () => {
      const result = t.float().parse({ value: 1.5, data, invoker });
      expect(expectParsed(result)).toBe(1.5);
    });

    test("validates boolean type", () => {
      const ok = t.bool().parse({ value: true, data, invoker });
      expect(expectParsed(ok)).toBe(true);

      const bad = t.bool().parse({ value: "true", data, invoker });
      expect(bad.issues).toBeDefined();
      expect(bad.issues?.[0]?.message).toEqual("Expected a boolean: received true");
    });
  });

  describe("validates format-specific types", () => {
    test.each([
      {
        name: "uuid",
        field: t.uuid(),
        validValue: "550e8400-e29b-41d4-a716-446655440000",
        invalidValue: "not-a-uuid",
        invalidMessage: "Expected a valid UUID: received not-a-uuid",
      },
      {
        name: "date",
        field: t.date(),
        validValue: "2025-12-21",
        invalidValue: "2025/12/21",
        invalidMessage: 'Expected to match "yyyy-MM-dd" format: received 2025/12/21',
      },
      {
        name: "datetime",
        field: t.datetime(),
        validValue: "2025-12-21T10:11:12.123Z",
        invalidValue: "2025-12-21 10:11:12",
        invalidMessage: "Expected to match ISO format: received 2025-12-21 10:11:12",
      },
      {
        name: "time",
        field: t.time(),
        validValue: "10:11",
        invalidValue: "10:11:12",
        invalidMessage: 'Expected to match "HH:mm" format: received 10:11:12',
      },
    ])("validates $name format", ({ field, validValue, invalidValue, invalidMessage }) => {
      const ok = field.parse({ value: validValue, data, invoker });
      if (ok.issues) {
        throw new Error("Unexpected issues");
      }
      expect(ok.value).toBe(validValue);

      const bad = field.parse({ value: invalidValue, data, invoker });
      expect(bad.issues).toBeDefined();
      expect(bad.issues?.[0]?.message).toEqual(invalidMessage);
    });

    test("accepts a date with an out-of-range day (e.g. February 30)", () => {
      const result = t.date().parse({ value: "2025-02-30", data, invoker });
      expect(expectParsed(result)).toBe("2025-02-30");
    });

    test.each([
      "2025-12-21T10:11:12Z",
      "2025-12-21T10:11:12.123456Z",
      "2025-12-21T10:11:12+09:00",
      "2025-12-21t10:11:12-08:00",
      "2025-02-30T10:11:12Z",
    ])("validates datetime format - accepts %s", (value) => {
      const result = t.datetime().parse({ value, data, invoker });
      expect(expectParsed(result)).toBe(value);
    });

    test.each([
      {
        value: "2025-12-21T10:11:12+0900",
        message: "Expected to match ISO format: received 2025-12-21T10:11:12+0900",
      },
      {
        value: "2025-12-21T25:11:12Z",
        message: "Expected to match ISO format: received 2025-12-21T25:11:12Z",
      },
      {
        value: "2025-12-21T10:11:12+24:00",
        message: "Expected to match ISO format: received 2025-12-21T10:11:12+24:00",
      },
    ])("validates datetime format - rejects $value", ({ value, message }) => {
      const result = t.datetime().parse({ value, data, invoker });
      expect(result.issues).toBeDefined();
      expect(result.issues?.[0]?.message).toEqual(message);
    });
  });

  describe("validates complex types", () => {
    test("validates enum values", () => {
      const status = t.enum(["active", "inactive"]);

      const ok = status.parse({ value: "active", data, invoker });
      expect(expectParsed(ok)).toBe("active");

      const bad = status.parse({ value: "pending", data, invoker });
      expect(bad.issues).toBeDefined();
      expect(bad.issues?.[0]?.message).toEqual(
        "Must be one of [active, inactive]: received pending",
      );
    });

    test("validates nested object fields", () => {
      const schema = t.object({
        name: t.string(),
        age: t.int({ optional: true }),
        gender: t.enum(["male", "female", "other"]),
      });

      const ok = schema.parse({
        value: { name: "name", age: null, gender: "male" },
        data,
        invoker,
      });
      expect(expectParsed(ok)).toEqual({ name: "name", age: null, gender: "male" });

      const bad = schema.parse({ value: { age: 1, gender: "invalid" }, data, invoker });
      expect(bad.issues).toBeDefined();
      expect(bad.issues).toEqual([
        { message: "Required field is missing", path: ["name"] },
        { message: "Must be one of [male, female, other]: received invalid", path: ["gender"] },
      ]);

      const notAnObjectSchema = t.object({ value: t.string({ optional: true }) });
      const now = new Date();
      const notAnObject = notAnObjectSchema.parse({ value: now, data, invoker });
      expect(notAnObject.issues).toBeDefined();
      expect(notAnObject.issues?.[0]?.message).toEqual(
        `Expected an object: received ${String(now)}`,
      );
    });

    test("validates array fields and element paths", () => {
      const schema = t.int({ array: true });

      const ok = schema.parse({ value: [1, 2, 3], data, invoker });
      expect(expectParsed(ok)).toEqual([1, 2, 3]);

      const notAnArray = schema.parse({ value: "invalid", data, invoker });
      expect(notAnArray.issues).toBeDefined();
      expect(notAnArray.issues?.[0]?.message).toEqual("Expected an array");

      const badElement = schema.parse({ value: [1, "x"], data, invoker });
      expect(badElement.issues).toBeDefined();
      expect(badElement.issues?.[0]).toEqual({
        path: ["[1]"],
        message: "Expected an integer: received x",
      });
    });

    test("treats null/undefined as missing when required, and allowed when optional", () => {
      const required = t.string().parse({ value: null, data, invoker });
      expect(required.issues).toBeDefined();
      expect(required.issues?.[0]?.message).toEqual("Required field is missing");

      const optionalScalar = t.string({ optional: true }).parse({ value: null, data, invoker });
      expect(expectParsed(optionalScalar)).toBeNull();

      const optionalArray = t
        .int({ optional: true, array: true })
        .parse({ value: null, data, invoker });
      expect(expectParsed(optionalArray)).toBeNull();
    });
  });

  describe("validates decimal type", () => {
    test.each([
      "123.45",
      "0",
      "-99.99",
      "1000",
      ".5",
      "5.",
      "4.321e+4",
      "1E-5",
      "2.41E-3",
      "-1.5e10",
    ])("accepts valid decimal string %s", (value) => {
      const result = t.decimal().parse({ value, data, invoker });
      expect(expectParsed(result)).toBe(value);
    });

    test.each(["abc", "", "1_000_000", "0b1.1p-5", "1e", "e5", ".", 123])(
      "rejects invalid decimal value %s",
      (value) => {
        const result = t.decimal().parse({ value, data, invoker });
        expect(result.issues).toBeDefined();
      },
    );
  });
});

describe("TailorField clone-on-write / no aliasing", () => {
  test("description() returns a clone and never mutates the original", () => {
    const original = t.string();
    const updated = original.description("for A");

    expect(original.metadata.description).toBeUndefined();
    expect(updated.metadata.description).toBe("for A");
    expect(updated).not.toBe(original);
  });

  test("typeName() returns a clone and never mutates the original", () => {
    const original = t.object({ name: t.string() });
    const updated = original.typeName("Custom");

    expect(original.metadata.typeName).toBeUndefined();
    expect(updated.metadata.typeName).toBe("Custom");
    expect(updated).not.toBe(original);
  });

  test("validate() returns a clone and never mutates the original", () => {
    const original = t.string();
    const updated = original.validate((args) => args.value.length > 0);

    expect(original.metadata.validate).toBeUndefined();
    expect(updated.metadata.validate).toHaveLength(1);
    expect(updated).not.toBe(original);
  });

  test("a field instance shared across places does not leak metadata", () => {
    const shared = t.string();
    const a = shared;
    const b = shared;
    a.description("for A");

    expect(b.metadata.description).toBeUndefined();
  });

  test("t.object does not let builder calls leak into the caller's record", () => {
    const inner = { city: t.string() };
    const objField = t.object(inner);
    objField.fields.city!.description("mutated");

    expect(inner.city.metadata.description).toBeUndefined();
    expect(objField.fields.city!.metadata.description).toBeUndefined();
  });

  test("chained builders accumulate metadata on the returned clone", () => {
    const field = t.object({ name: t.string() }).typeName("Custom").description("a custom object");

    expect(field.metadata.typeName).toBe("Custom");
    expect(field.metadata.description).toBe("a custom object");
  });

  test("clone-on-write deep-clones nested object fields (no shared instances)", () => {
    const original = t.object({ city: t.string() });
    // description() clones the object field; nested fields must be deep-cloned too.
    const updated = original.description("an object");

    expect(updated).not.toBe(original);
    expect(updated.fields.city).not.toBe(original.fields.city);

    updated.fields.city!.description("mutated");
    expect(original.fields.city!.metadata.description).toBeUndefined();
  });

  test("clone-on-write preserves options and enum values", () => {
    const original = t.enum(["active", "inactive"], { array: true, optional: true });
    const cloned = original.description("status");

    expect(cloned.metadata.array).toBe(true);
    expect(cloned.metadata.required).toBe(false);
    expect(cloned.metadata.allowedValues).toEqual(original.metadata.allowedValues);
    expect(cloned.metadata.description).toBe("status");
  });

  test("clone-on-write deep-copies mutable metadata so clones never share containers", () => {
    const enumField = t.enum(["active", "inactive"]);
    const enumClone = enumField.description("status");
    // Same contents, but separate array AND separate value objects.
    expect(enumClone.metadata.allowedValues).toEqual(enumField.metadata.allowedValues);
    expect(enumClone.metadata.allowedValues).not.toBe(enumField.metadata.allowedValues);
    expect(enumClone.metadata.allowedValues?.[0]).not.toBe(enumField.metadata.allowedValues?.[0]);

    const validated = t.string().validate((args) => args.value.length > 0);
    const validatedClone = validated.description("name");
    expect(validatedClone.metadata.validate).not.toBe(validated.metadata.validate);
  });

  test("clone-on-write rebinds validation closures so parse still works", () => {
    const status = t.enum(["active", "inactive"]);
    const cloned = status.description("status field");

    const ok = cloned.parse({ value: "active", data, invoker });
    expect(ok.issues).toBeUndefined();

    const ng = cloned.parse({ value: "pending", data, invoker });
    expect(ng.issues).toBeDefined();
    expect(ng.issues?.[0]?.message).toEqual("Must be one of [active, inactive]: received pending");
  });

  test("validate() preserves function references through cloning", () => {
    const calls: unknown[] = [];
    const field = t.string().validate((args) => {
      calls.push(args.value);
      return args.value.length > 0;
    });

    const result = field.parse({ value: "x", data, invoker });
    expect(result.issues).toBeUndefined();
    expect(calls).toEqual(["x"]);
  });

  test("validators survive a clone triggered by a later builder, leaving the original intact", () => {
    const validated = t.string().validate((args) => args.value.length > 0);
    // description() clones the field; the validators must carry over to the clone
    // and keep working, while the original stays unchanged.
    const described = validated.description("name");

    expect(described.metadata.validate).toHaveLength(1);
    expect(described.metadata.description).toBe("name");
    expect(validated.metadata.description).toBeUndefined();

    const failed = described.parse({ value: "", data, invoker });
    expect(failed.issues).toBeDefined();
  });
});
