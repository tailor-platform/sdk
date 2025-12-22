import { describe, it, expect, expectTypeOf } from "vitest";
import { t } from "./type";
import type { output } from "./helpers";
import type { TailorUser } from "./user";

describe("TailorType basic field type tests", () => {
  it("string field outputs string type correctly", () => {
    const _stringType = t.object({
      name: t.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  it("int field outputs number type correctly", () => {
    const _intType = t.object({
      age: t.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      age: number;
    }>();
  });

  it("bool field outputs boolean type correctly", () => {
    const _boolType = t.object({
      active: t.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      active: boolean;
    }>();
  });

  it("float field outputs number type correctly", () => {
    const _floatType = t.object({
      price: t.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      price: number;
    }>();
  });

  it("uuid field outputs string type correctly", () => {
    const _uuidType = t.object({
      id: t.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: string;
    }>();
  });

  it("date field outputs string type correctly", () => {
    const _dateType = t.object({
      birthDate: t.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      birthDate: string;
    }>();
  });

  it("datetime field outputs string | Date type correctly", () => {
    const _datetimeType = t.object({
      createdAt: t.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toEqualTypeOf<{
      createdAt: string | Date;
    }>();
  });

  it("time field outputs string type correctly", () => {
    const _timeType = t.object({
      openingTime: t.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      openingTime: string;
    }>();
  });
});

describe("TailorField optional option tests", () => {
  it("optional option generates nullable type", () => {
    const _optionalType = t.object({
      description: t.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      description?: string | null;
    }>();
  });

  it("multiple optional fields work correctly", () => {
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
  it("array option generates array type", () => {
    const _arrayType = t.object({
      tags: t.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      tags: string[];
    }>();
  });

  it("optional array works correctly", () => {
    const _optionalArrayType = t.object({
      items: t.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      items?: string[] | null;
    }>();
  });

  it("multiple array fields work correctly", () => {
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
  it("set enum field by passing string", () => {
    const enumField = t.enum(["active", "inactive", "pending"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<
      "active" | "inactive" | "pending"
    >();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);
  });

  it("set enum field by passing object", () => {
    const enumField = t.enum([
      { value: "small", description: "Small size" },
      { value: "medium" },
      { value: "large", description: "Large size" },
    ]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<
      "small" | "medium" | "large"
    >();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "small", description: "Small size" },
      { value: "medium", description: "" },
      { value: "large", description: "Large size" },
    ]);
  });

  it("set enum field by mixing string and object", () => {
    const enumField = t.enum([
      "red",
      { value: "green", description: "Green color" },
      "blue",
    ]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<
      "red" | "green" | "blue"
    >();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "red", description: "" },
      { value: "green", description: "Green color" },
      { value: "blue", description: "" },
    ]);
  });

  it("setting enum without values causes type error", () => {
    // @ts-expect-error AllowedValues requires at least one value
    t.enum([]);
    // @ts-expect-error AllowedValues requires at least one value
    t.enum([], { optional: true });
  });

  it("optional enum() works correctly", () => {
    const _optionalEnumType = t.object({
      priority: t.enum(["high", "medium", "low"], { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum array works correctly", () => {
    const _enumArrayType = t.object({
      categories: t.enum(["a", "b", "c"], { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorType composite type tests", () => {
  it("type with multiple fields works correctly", () => {
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
      id: string;
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
  it("type with single field works correctly", () => {
    const _singleFieldType = t.object({
      value: t.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      value: string;
    }>();
  });

  it("type with all optional fields works correctly", () => {
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

  it("type with all array fields works correctly", () => {
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
  it("same definition generates same type", () => {
    const _type1 = t.object({
      name: t.string(),
      age: t.int(),
    });
    const _type2 = t.object({
      name: t.string(),
      age: t.int(),
    });
    expectTypeOf<output<typeof _type1>>().toEqualTypeOf<
      output<typeof _type2>
    >();
  });
});

describe("t.object tests", () => {
  it("correctly infers basic object type", () => {
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

  it("correctly infers object type with optional fields", () => {
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

  it("correctly infers object type with array fields", () => {
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

  it("correctly infers nested object type", () => {
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

  it("correctly infers object type with optional option", () => {
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

  it("correctly infers object type with array option", () => {
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
        id: string;
        name: string;
      }[];
    }>();
  });

  it("correctly infers object type with multiple modifiers", () => {
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
            id: string;
            value?: string | null;
          }[]
        | null;
    }>();
  });

  it("correctly infers object type with enum type", () => {
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

  it("correctly infers object type with single field", () => {
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

  it("correctly infers empty object", () => {
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
  const user: TailorUser = {
    id: "test",
    type: "user",
    workspaceId: "workspace-test",
    attributes: {},
    attributeList: [],
  };

  describe("validates primitive types", () => {
    it("validates string type", () => {
      {
        const result = t.string().parse({ value: "valid string", user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("valid string");
      }

      {
        const result = t.string().parse({ value: 123, user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected a string: received 123",
        );
        expect(result.issues?.[0]?.path).toBeUndefined();
      }
    });

    it("validates integer type", () => {
      {
        const result = t.int().parse({ value: 123, user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(123);
      }

      {
        const result = t.int().parse({ value: "invalid string", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected an integer: received invalid string",
        );
      }

      {
        const result = t.int().parse({ value: 1.5, user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected an integer: received 1.5",
        );
      }
    });

    it("validates float type", () => {
      {
        const result = t.float().parse({ value: 1.5, user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(1.5);
      }

      {
        const result = t.float().parse({ value: Number.NaN, user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected a number: received NaN",
        );
      }

      {
        const result = t.float().parse({ value: "invalid string", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected a number: received invalid string",
        );
      }
    });

    it("validates boolean type", () => {
      {
        const result = t.bool().parse({ value: true, user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe(true);
      }

      {
        const result = t.bool().parse({ value: "true", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected a boolean: received true",
        );
      }
    });
  });

  describe("validates format-specific types", () => {
    it("validates uuid format", () => {
      {
        const result = t.uuid().parse({
          value: "550e8400-e29b-41d4-a716-446655440000",
          user,
        });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("550e8400-e29b-41d4-a716-446655440000");
      }

      {
        const result = t.uuid().parse({ value: "not-a-uuid", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected a valid UUID: received not-a-uuid",
        );
      }
    });

    it("validates date format", () => {
      {
        const result = t.date().parse({ value: "2025-12-21", user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("2025-12-21");
      }

      {
        const result = t.date().parse({ value: "2025/12/21", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          'Expected to match "yyyy-MM-dd" format: received 2025/12/21',
        );
      }
    });

    it("validates datetime format", () => {
      {
        const result = t.datetime().parse({
          value: "2025-12-21T10:11:12.123Z",

          user,
        });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("2025-12-21T10:11:12.123Z");
      }

      {
        const result = t
          .datetime()
          .parse({ value: "2025-12-21 10:11:12", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Expected to match ISO format: received 2025-12-21 10:11:12",
        );
      }
    });

    it("vlidates time format", () => {
      {
        const result = t.time().parse({ value: "10:11", user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("10:11");
      }

      {
        const result = t.time().parse({ value: "10:11:12", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          'Expected to match "HH:mm" format: received 10:11:12',
        );
      }
    });
  });

  describe("validates complex types", () => {
    it("validates enum values", () => {
      const status = t.enum(["active", "inactive"]);
      {
        const result = status.parse({ value: "active", user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBe("active");
      }

      {
        const result = status.parse({ value: "pending", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Must be one of [active, inactive]: received pending",
        );
      }
    });

    it("validates nested object fields", () => {
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
          user,
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
          user,
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
        const result = schema.parse({ value: now, user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          `Expected an object: received ${String(now)}`,
        );
      }
    });

    it("validates array fields and element paths", () => {
      const schema = t.int({ array: true });
      {
        const result = schema.parse({ value: [1, 2, 3], user });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toEqual([1, 2, 3]);
      }

      {
        const result = schema.parse({ value: "invalid", user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual("Expected an array");
      }

      {
        const result = schema.parse({ value: [1, "x"], user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]).toEqual({
          path: ["[1]"],
          message: "Expected an integer: received x",
        });
      }
    });

    it("treats null/undefined as missing when required, and allowed when optional", () => {
      {
        const schema = t.string();
        const result = schema.parse({ value: null, user });
        expect(result.issues).toBeDefined();
        expect(result.issues?.[0]?.message).toEqual(
          "Required field is missing",
        );
      }

      {
        const schema = t.string({ optional: true });
        const result = schema.parse({ value: null, user });
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
          user,
        });
        expect(result.issues).toBeUndefined();
        if (result.issues) {
          throw new Error("Unexpected issues");
        }
        expect(result.value).toBeNull();
      }
    });
  });
});
