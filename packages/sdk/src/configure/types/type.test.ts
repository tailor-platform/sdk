// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expect, test, expectTypeOf } from "vitest";
import { t } from "./type";
import type { TailorPrincipal } from "#/runtime/types";
import type { output } from "#/types/helpers";
import type { AllowedValues } from "./field";

type DateString = `${number}-${number}-${number}`;
type TimeString = `${number}:${number}`;
type TimeZoneOffsetString = "Z" | "z" | `${"+" | "-"}${TimeString}`;
type DateTimeString =
  `${DateString}${"T" | "t"}${TimeString}:${number}${"" | `.${number}`}${TimeZoneOffsetString}`;
type UUIDString = `${string}-${string}-${string}-${string}-${string}`;

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
  test("set enum field by passing string", () => {
    const enumField = t.enum(["active", "inactive", "pending"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"active" | "inactive" | "pending">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);
  });

  test("set enum field by passing object", () => {
    const enumField = t.enum([
      { value: "small", description: "Small size" },
      { value: "medium" },
      { value: "large", description: "Large size" },
    ]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"small" | "medium" | "large">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "small", description: "Small size" },
      { value: "medium", description: "" },
      { value: "large", description: "Large size" },
    ]);
  });

  test("set enum field by mixing string and object", () => {
    const enumField = t.enum(["red", { value: "green", description: "Green color" }, "blue"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"red" | "green" | "blue">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "red", description: "" },
      { value: "green", description: "Green color" },
      { value: "blue", description: "" },
    ]);
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

  test("accepts as const readonly array", () => {
    const STATUSES = ["active", "inactive", "pending"] as const;
    const enumField = t.enum(STATUSES);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"active" | "inactive" | "pending">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);
  });

  test("AllowedValues type accepts readonly arrays", () => {
    const STATUSES = ["active", "inactive"] as const;
    // Verify that readonly arrays are assignable to AllowedValues
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
  const invoker: TailorPrincipal = {
    id: "test",
    type: "user",
    workspaceId: "workspace-test",
    attributes: {},
    attributeList: [],
  };
  const data = {};

  describe("validates primitive types", () => {
    test("validates string type", () => {
      {
        const result = t.string().parse({ value: "valid string", data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("valid string");
      }

      {
        const result = t.string().parse({ value: 123, data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected a string: received 123");
        expect(result.issues?.[0]?.path).toBeUndefined();
      }
    });

    test("validates integer type", () => {
      {
        const result = t.int().parse({ value: 123, data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(123);
      }

      {
        const result = t.int().parse({ value: "invalid string", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected an integer: received invalid string");
      }

      {
        const result = t.int().parse({ value: 1.5, data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected an integer: received 1.5");
      }
    });

    test("validates float type", () => {
      {
        const result = t.float().parse({ value: 1.5, data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(1.5);
      }

      {
        const result = t.float().parse({ value: Number.NaN, data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected a number: received NaN");
      }

      {
        const result = t.float().parse({ value: "invalid string", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected a number: received invalid string");
      }
    });

    test("validates boolean type", () => {
      {
        const result = t.bool().parse({ value: true, data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(true);
      }

      {
        const result = t.bool().parse({ value: "true", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected a boolean: received true");
      }
    });
  });

  describe("validates format-specific types", () => {
    test("validates uuid format", () => {
      {
        const result = t.uuid().parse({
          value: "550e8400-e29b-41d4-a716-446655440000",
          data,
          invoker,
        });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("550e8400-e29b-41d4-a716-446655440000");
      }

      {
        const result = t.uuid().parse({ value: "not-a-uuid", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected a valid UUID: received not-a-uuid");
      }
    });

    test("validates date format", () => {
      {
        const result = t.date().parse({ value: "2025-12-21", data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("2025-12-21");
      }

      {
        const result = t.date().parse({ value: "2025/12/21", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          'Expected to match "yyyy-MM-dd" format: received 2025/12/21',
        );
      }

      {
        const result = t.date().parse({ value: "2025-02-30", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          'Expected to match "yyyy-MM-dd" format: received 2025-02-30',
        );
      }
    });

    test("validates datetime format", () => {
      for (const value of [
        "2025-12-21T10:11:12Z",
        "2025-12-21T10:11:12.123456Z",
        "2025-12-21T10:11:12+09:00",
        "2025-12-21t10:11:12-08:00",
      ]) {
        const result = t.datetime().parse({ value, data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(value);
      }

      {
        const result = t.datetime().parse({
          value: "2025-12-21T10:11:12+0900",
          data,
          invoker,
        });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected to match ISO format: received 2025-12-21T10:11:12+0900",
        );
      }

      {
        const result = t.datetime().parse({ value: "2025-12-21T25:11:12Z", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected to match ISO format: received 2025-12-21T25:11:12Z",
        );
      }

      {
        const result = t.datetime().parse({
          value: "2025-12-21T10:11:12+24:00",
          data,
          invoker,
        });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected to match ISO format: received 2025-12-21T10:11:12+24:00",
        );
      }
    });

    test("vlidates time format", () => {
      {
        const result = t.time().parse({ value: "10:11", data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("10:11");
      }

      {
        const result = t.time().parse({ value: "10:11:12", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          'Expected to match "HH:mm" format: received 10:11:12',
        );
      }
    });
  });

  describe("validates complex types", () => {
    test("validates enum values", () => {
      const status = t.enum(["active", "inactive"]);
      {
        const result = status.parse({ value: "active", data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("active");
      }

      {
        const result = status.parse({ value: "pending", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Must be one of [active, inactive]: received pending",
        );
      }
    });

    test("validates nested object fields", () => {
      const schema = t.object({
        name: t.string(),
        age: t.int({ optional: true }),
        gender: t.enum(["male", "female", "other"]),
      });
      {
        const result = schema.parse({
          value: {
            name: "name",
            age: null,
            gender: "male",
          },
          data,
          invoker,
        });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toEqual({
          name: "name",
          age: null,
          gender: "male",
        });
      }

      {
        const result = schema.parse({
          value: { age: 1, gender: "invalid" },
          data,
          invoker,
        });
        expect(result.issues).toBeDefined();
        expect(result.issues).toEqual([
          {
            message: "Required field is missing",
            path: ["name"],
          },
          {
            message: "Must be one of [male, female, other]: received invalid",
            path: ["gender"],
          },
        ]);
      }

      {
        const schema = t.object({
          value: t.string({ optional: true }),
        });
        const now = new Date();
        const result = schema.parse({ value: now, data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(`Expected an object: received ${String(now)}`);
      }
    });

    test("validates array fields and element paths", () => {
      const schema = t.int({ array: true });
      {
        const result = schema.parse({ value: [1, 2, 3], data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toEqual([1, 2, 3]);
      }

      {
        const result = schema.parse({ value: "invalid", data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected an array");
      }

      {
        const result = schema.parse({ value: [1, "x"], data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]).toEqual({
          path: ["[1]"],
          message: "Expected an integer: received x",
        });
      }
    });

    test("treats null/undefined as missing when required, and allowed when optional", () => {
      {
        const schema = t.string();
        const result = schema.parse({ value: null, data, invoker });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Required field is missing");
      }

      {
        const schema = t.string({ optional: true });
        const result = schema.parse({ value: null, data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBeNull();
      }

      {
        const schema = t.int({ optional: true, array: true });
        const result = schema.parse({
          value: null,
          data,
          invoker,
        });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBeNull();
      }
    });
  });

  describe("validates decimal type", () => {
    test("accepts valid decimal strings", () => {
      for (const value of [
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
      ]) {
        const result = t.decimal().parse({ value, data, invoker });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error(`Unexpected issues for "${value}"`);
        }
        expect(result.value).toBe(value);
      }
    });

    test("rejects invalid decimal values", () => {
      for (const value of ["abc", "", "1_000_000", "0b1.1p-5", "1e", "e5", "."]) {
        const result = t.decimal().parse({ value, data, invoker });
        expect(result.issues).toBeDefined();
      }
      {
        const result = t.decimal().parse({ value: 123, data, invoker });
        expect(result.issues).toBeDefined();
      }
    });
  });
});

describe("TailorField clone-on-write / no aliasing", () => {
  const invoker: TailorPrincipal = {
    id: "test",
    type: "user",
    workspaceId: "workspace-test",
    attributes: {},
    attributeList: [],
  };
  const data = {};

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
