// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expectTypeOf, expect, test } from "vitest";
import { t } from "#/configure/types/index";
import { db, type TailorAnyDBField } from "./schema";
import type { FieldValidateInput, ValidateConfig } from "#/configure/types/field.types";
import type { TailorPrincipal } from "#/runtime/types";
import type { output, TypeLevelError } from "#/types/helpers";
import type { Hook } from "./types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

describe("TailorDB table builder", () => {
  test("db.table creates a table with the generated id field", () => {
    const user = db.table("User", {
      name: db.string(),
    });

    expect(user.name).toBe("User");
    expect(user.fields.id).toBeDefined();
    expectTypeOf<output<typeof user>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });
});

describe("TailorDBField basic field type tests", () => {
  test("string field outputs string type correctly", () => {
    const _stringType = db.table("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  test("int field outputs number type correctly", () => {
    const _intType = db.table("Test", {
      age: db.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      id: string;
      age: number;
    }>();
  });

  test("bool field outputs boolean type correctly", () => {
    const _boolType = db.table("Test", {
      active: db.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      id: string;
      active: boolean;
    }>();
  });

  test("float field outputs number type correctly", () => {
    const _floatType = db.table("Test", {
      price: db.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      id: string;
      price: number;
    }>();
  });

  test("uuid field outputs string type correctly", () => {
    const _uuidType = db.table("Test", {
      uuid: db.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: string;
      uuid: string;
    }>();
  });

  test("date field outputs string type correctly", () => {
    const _dateType = db.table("Test", {
      birthDate: db.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      id: string;
      birthDate: string;
    }>();
  });

  test("datetime field outputs string | Date type correctly", () => {
    const _datetimeType = db.table("Test", {
      timestamp: db.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toMatchObjectType<{
      id: string;
      timestamp: string | Date;
    }>();
  });

  test("time field outputs string type correctly", () => {
    const _timeType = db.table("Test", {
      openingTime: db.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      id: string;
      openingTime: string;
    }>();
  });
});

describe("TailorDBField optional option tests", () => {
  test("optional option generates nullable type", () => {
    const _optionalType = db.table("Test", {
      description: db.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      id: string;
      description?: string | null;
    }>();
  });

  test("multiple optional fields work correctly", () => {
    const _multiOptionalType = db.table("Test", {
      title: db.string(),
      description: db.string({ optional: true }),
      count: db.int({ optional: true }),
    });
    expectTypeOf<output<typeof _multiOptionalType>>().toEqualTypeOf<{
      id: string;
      title: string;
      description?: string | null;
      count?: number | null;
    }>();
  });
});

describe("TailorDBField array option tests", () => {
  test("array option generates array type", () => {
    const _arrayType = db.table("Test", {
      tags: db.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      id: string;
      tags: string[];
    }>();
  });

  test("optional array works correctly", () => {
    const _optionalArrayType = db.table("Test", {
      items: db.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      id: string;
      items?: string[] | null;
    }>();
  });

  test("multiple array fields work correctly", () => {
    const _multiArrayType = db.table("Test", {
      tags: db.string({ array: true }),
      numbers: db.int({ array: true }),
      flags: db.bool({ array: true }),
    });
    expectTypeOf<output<typeof _multiArrayType>>().toEqualTypeOf<{
      id: string;
      tags: string[];
      numbers: number[];
      flags: boolean[];
    }>();
  });
});

describe("TailorDBField enum field tests", () => {
  test("set enum field by passing string", () => {
    const enumField = db.enum(["active", "inactive", "pending"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"active" | "inactive" | "pending">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);
  });

  test("set enum field by passing object", () => {
    const enumField = db.enum([
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
    const enumField = db.enum(["red", { value: "green", description: "Green color" }, "blue"]);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"red" | "green" | "blue">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "red", description: "" },
      { value: "green", description: "Green color" },
      { value: "blue", description: "" },
    ]);
  });

  test("setting enum without values causes type error", () => {
    // @ts-expect-error AllowedValues requires at least one value
    db.enum([]);
    // @ts-expect-error AllowedValues requires at least one value
    db.enum([], { optional: true });
  });

  test("optional enum() works correctly", () => {
    const _optionalEnumType = db.table("Test", {
      priority: db.enum(["high", "medium", "low"], { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      id: string;
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  test("accepts as const readonly array", () => {
    const STATUSES = ["active", "inactive", "pending"] as const;
    const enumField = db.enum(STATUSES);
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<"active" | "inactive" | "pending">();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);
  });

  test("enum array works correctly", () => {
    const _enumArrayType = db.table("Test", {
      categories: db.enum(["a", "b", "c"], { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      id: string;
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorDBField RelationConfig option field tests", () => {
  const User = db.table("User", {
    name: db.string(),
    email: db.string(),
  });

  const Customer = db.table("Customer", {
    name: db.string(),
    customerId: db.string(),
  });

  test("when toward.as is omitted, undefined is stored (inflection is executed at parser layer)", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        key: "id",
      },
    });

    // Raw relation config is stored, processing happens in parser layer
    expect(userField.rawRelation!.toward.type).toEqual("User");
    expect(userField.rawRelation!.toward.as).toBeUndefined();
    expect(userField.rawRelation!.toward.key).toEqual("id");
    expect(userField.rawRelation!.backward).toBeUndefined();
  });

  test("behavior when toward.as, toward.key, and backward are all explicitly specified", () => {
    const managerField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        as: "manager",
        key: "email",
      },
      backward: "subordinates",
    });

    // Raw relation config is stored
    expect(managerField.rawRelation!.toward.type).toEqual("User");
    expect(managerField.rawRelation!.toward.as).toEqual("manager");
    expect(managerField.rawRelation!.toward.key).toEqual("email");
    expect(managerField.rawRelation!.backward).toEqual("subordinates");
  });

  test("behavior when only toward.as is explicitly specified", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        as: "owner",
      },
    });

    // Raw relation config is stored
    expect(userField.rawRelation!.toward.type).toEqual("User");
    expect(userField.rawRelation!.toward.as).toEqual("owner");
    expect(userField.rawRelation!.toward.key).toBeUndefined();
    expect(userField.rawRelation!.backward).toBeUndefined();
  });

  test("behavior when only toward.key is explicitly specified", () => {
    const customerField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: Customer,
        key: "customerId",
      },
    });

    // Raw relation config is stored
    expect(customerField.rawRelation!.toward.type).toEqual("Customer");
    expect(customerField.rawRelation!.toward.as).toBeUndefined();
    expect(customerField.rawRelation!.toward.key).toEqual("customerId");
    expect(customerField.rawRelation!.backward).toBeUndefined();
  });

  test("specifying non-existent field name for toward.key causes type error", () => {
    // @ts-ignore 'nonExisting' does not exist on type 'Customer'
    // NOTE: This is required for tsc/tsgo compatibility.
    // tsc and tsgo (TypeScript v7) report the same type error on different nodes.
    // Because tsgo does not report an error on this specific line,
    // using @ts-expect-error would fail under tsgo.
    // Therefore, @ts-ignore is used to suppress the error in both cases.
    db.uuid().relation({
      type: "oneToOne",
      toward: {
        // @ts-ignore Suppress tsgo error for tsc/tsgo compatibility.
        // tsgo (TypeScript v7) reports an error here, while tsc reports it elsewhere.
        type: Customer,
        key: "nonExisting",
      },
    });
  });

  test("behavior when only backward is explicitly specified", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
      },
      backward: "relatedItems",
    });

    // Raw relation config is stored
    expect(userField.rawRelation!.toward.type).toEqual("User");
    expect(userField.rawRelation!.toward.as).toBeUndefined();
    expect(userField.rawRelation!.toward.key).toBeUndefined();
    expect(userField.rawRelation!.backward).toEqual("relatedItems");
  });

  test("type inference verification for manyToOne relation", () => {
    const userField = db.uuid().relation({
      type: "manyToOne",
      toward: {
        type: User,
        as: "author",
        key: "email",
      },
      backward: "posts",
    });

    // Raw relation config is stored
    expect(userField.rawRelation!.toward.type).toEqual("User");
    expect(userField.rawRelation!.toward.as).toEqual("author");
    expect(userField.rawRelation!.toward.key).toEqual("email");
    expect(userField.rawRelation!.backward).toEqual("posts");
  });
});

describe("TailorDBField modifier chain tests", () => {
  test("index() modifier does not affect type", () => {
    const _indexType = db.table("Test", {
      email: db.string().index(),
    });
    expectTypeOf<output<typeof _indexType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  test("unique() modifier does not affect type", () => {
    const _uniqueType = db.table("Test", {
      username: db.string().unique(),
    });
    expectTypeOf<output<typeof _uniqueType>>().toEqualTypeOf<{
      id: string;
      username: string;
    }>();
  });
});

describe("TailorDBField type error message tests", () => {
  test("invalid field modifiers expose type-level error messages", () => {
    const dbField = db.string();
    expectTypeOf(dbField.typeName).toEqualTypeOf<
      TypeLevelError<"typeName cannot be used on TailorDB fields">
    >();

    const erasedDBField: TailorAnyDBField = db.string();
    // @ts-expect-error typeName cannot be used on TailorDB fields
    erasedDBField.typeName("InvalidTypeName");

    const described = db.string().description("Name");
    expectTypeOf(described.description).toEqualTypeOf<
      TypeLevelError<".description() has already been set">
    >();

    const _userType = db.table("User", {
      name: db.string(),
    });
    const related = db.uuid().relation({
      type: "oneToOne",
      toward: { type: _userType },
    });
    expectTypeOf(related.relation).toEqualTypeOf<
      TypeLevelError<".relation() has already been set">
    >();

    const indexed = db.string().index();
    expectTypeOf(indexed.index).toEqualTypeOf<TypeLevelError<".index() has already been set">>();

    const arrayString = db.string({ array: true });
    expectTypeOf(arrayString.index).toEqualTypeOf<
      TypeLevelError<"index cannot be set on array fields">
    >();

    const unique = db.string().unique();
    expectTypeOf(unique.unique).toEqualTypeOf<TypeLevelError<".unique() has already been set">>();

    const uniqueArray = db.string({ array: true });
    expectTypeOf(uniqueArray.unique).toEqualTypeOf<
      TypeLevelError<"unique cannot be set on array fields">
    >();

    const vector = db.string().vector();
    expectTypeOf(vector.vector).toEqualTypeOf<TypeLevelError<".vector() has already been set">>();

    const nonString = db.int();
    expectTypeOf(nonString.vector).toEqualTypeOf<
      TypeLevelError<"vector can only be set on non-array string fields">
    >();

    const hooked = db.string().hooks({ create: () => "created" });
    expectTypeOf(hooked.hooks).toEqualTypeOf<TypeLevelError<".hooks() has already been set">>();
    expectTypeOf(hooked.serial).toEqualTypeOf<TypeLevelError<"serial cannot be set after hooks">>();

    const emptyHooked = db.string().hooks({});
    expectTypeOf(emptyHooked.hooks).toEqualTypeOf<
      TypeLevelError<".hooks() has already been set">
    >();

    const nested = db.object({ name: db.string() });
    expectTypeOf(nested.hooks).toEqualTypeOf<
      TypeLevelError<"hooks cannot be set on nested type fields">
    >();

    const validated = db.string().validate(() => true);
    expectTypeOf(validated.validate).toEqualTypeOf<
      TypeLevelError<".validate() has already been set">
    >();

    const serial = db.string().serial({ start: 0 });
    expectTypeOf(serial.serial).toEqualTypeOf<TypeLevelError<".serial() has already been set">>();
    expectTypeOf(serial.hooks).toEqualTypeOf<TypeLevelError<"hooks cannot be set after serial">>();

    const nonSerial = db.bool();
    expectTypeOf(nonSerial.serial).toEqualTypeOf<
      TypeLevelError<"serial can only be set on non-array integer or string fields">
    >();

    expectTypeOf(db.string({ optional: true }).serial).toEqualTypeOf<
      TypeLevelError<"serial can only be set on non-array integer or string fields">
    >();
  });

  test("field types stay assignable when a module helper erases fields via an unresolved generic", () => {
    // Mirrors a module-authoring pattern (`ReturnType<typeof genericFn>` with no
    // explicit type args) used to describe a helper's return shape without
    // pinning its optional custom-fields generic. With no type argument, the
    // generic resolves to its constraint (`Record<string, TailorAnyDBField>`),
    // which widens `array` from a literal to `boolean` and erases concrete
    // field metadata to `any` in nested positions (pickFields/clone). A type
    // built this way must stay assignable from a concrete instantiation of the
    // same helper, or every consumer using this pattern for module wiring
    // breaks the moment one of its fields is an array.
    function withCustomFields<
      const F extends Record<string, TailorAnyDBField> = Record<string, never>,
    >(fields?: F) {
      return db.type("WithCustomFields", {
        tags: db.string({ array: true }).description("array field to catch array-widening bugs"),
        ...(fields ?? ({} as F)),
      });
    }

    type GenericDefaultShape = ReturnType<typeof withCustomFields>;
    const concrete = withCustomFields({ name: db.string() });

    const accepts: (value: GenericDefaultShape) => void = () => {};
    accepts(concrete);
  });
});

describe("TailorDBField relation modifier tests", () => {
  test("relation does not create reference type", () => {
    const _userType = db.table("User", {
      name: db.string(),
    });
    const _postType = db.table("Post", {
      title: db.string(),
      authorId: db.uuid().relation({
        type: "oneToOne",
        toward: { type: _userType, as: "author" },
        backward: "author",
      }),
    });
    expectTypeOf<output<typeof _postType>>().toEqualTypeOf<{
      id: string;
      title: string;
      authorId: string;
    }>();
  });

  test("attempting to set relation twice causes type error", () => {
    const _userType = db.table("User", {
      name: db.string(),
    });

    const related = db.uuid().relation({
      type: "oneToOne",
      toward: { type: _userType },
    });
    // @ts-expect-error relation() cannot be called after relation() has already been called
    related.relation({
      type: "oneToOne",
      toward: { type: _userType },
    });
  });
});

describe("TailorDBField hooks modifier tests", () => {
  test("hooks modifier does not affect output type", () => {
    const _hookType = db.table("Test", {
      name: db.string().hooks({
        create: () => "created",
        update: () => "updated",
      }),
    });
    expectTypeOf<output<typeof _hookType>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  test("setting hooks on nested field causes type error", () => {
    const nested = db.object({
      first: db.string(),
      last: db.string(),
    });
    // @ts-expect-error hooks() cannot be called on nested fields
    nested.hooks({ create: () => ({ first: "A", last: "B" }) });
  });

  test("hooks modifier on string field receives string", () => {
    const _hooks = db.string().hooks;
    expectTypeOf<Parameters<typeof _hooks>[0]>().toEqualTypeOf<Hook<unknown, string>>();
  });

  test("hooks modifier on optional field receives null", () => {
    const _hooks = db.string({ optional: true }).hooks;
    expectTypeOf<Parameters<typeof _hooks>[0]>().toEqualTypeOf<Hook<unknown, string | null>>();
  });
});

describe("TailorDBField validate modifier tests", () => {
  test("validate modifier does not affect type", () => {
    const _validateType = db.table("Test", {
      email: db.string().validate(() => true),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  test("validate modifier can receive object with message", () => {
    const _validateType = db.table("Test", {
      email: db.string().validate([({ value }) => value.includes("@"), "Email must contain @"]),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();

    // Validate that the validation is stored correctly in metadata
    const fieldMetadata = _validateType.fields.email.metadata;
    expect(fieldMetadata.validate).toBeDefined();
    expect(fieldMetadata.validate).toHaveLength(1);
    // Error message is part of the tuple [fn, message]
    expect(fieldMetadata.validate?.[0]).toEqual([expect.any(Function), "Email must contain @"]);
  });

  test("validate modifier can receive multiple validators", () => {
    const _validateType = db.table("Test", {
      password: db
        .string()
        .validate(
          ({ value }) => value.length >= 8,
          [({ value }) => /[A-Z]/.test(value), "Password must contain uppercase letter"],
        ),
    });

    const fieldMetadata = _validateType.fields.password.metadata;
    expect(fieldMetadata.validate).toHaveLength(2);
    // Second validator is a tuple [fn, errorMessage]
    expect((fieldMetadata.validate?.[1] as [unknown, string])[1]).toBe(
      "Password must contain uppercase letter",
    );
  });

  test("calling validate modifier more than once causes type error", () => {
    const validated = db.string().validate(() => true);
    // @ts-expect-error validate() cannot be called after validate() has already been called
    validated.validate(() => true);
  });

  test("validate modifier on string field receives string", () => {
    const _validate = db.string().validate;
    expectTypeOf<Parameters<typeof _validate>[1]>().toEqualTypeOf<FieldValidateInput<string>>();
  });

  test("validate modifier on optional field receives null", () => {
    const _validate = db.string({ optional: true }).validate;
    expectTypeOf<Parameters<typeof _validate>[1]>().toEqualTypeOf<
      FieldValidateInput<string | null>
    >();
  });
});

describe("TailorDBField vector modifier tests", () => {
  test("vector modifier can only be used on string field", () => {
    const _vector = db.string().vector();
    expectTypeOf<output<typeof _vector>>().toEqualTypeOf<string>();
    expect(_vector.metadata.vector).toBe(true);

    // @ts-expect-error vector() can only be called on string fields
    db.int().vector();
    // @ts-expect-error vector() cannot be called on array fields
    db.string({ array: true }).vector();
  });

  test("calling vector modifier more than once causes type error", () => {
    // @ts-expect-error vector() cannot be called after vector() has already been called
    db.string().vector().vector();
  });
});

describe("TailorDBField serial modifier tests", () => {
  test("serial modifier can only be used on string and int fields", () => {
    const _stringSerial = db.string().serial({ start: 0 });
    expectTypeOf<output<typeof _stringSerial>>().toEqualTypeOf<string>();
    expect(_stringSerial.metadata.serial).toEqual({ start: 0 });

    const _intSerial = db.int().serial({ start: 100 });
    expectTypeOf<output<typeof _intSerial>>().toEqualTypeOf<number>();
    expect(_intSerial.metadata.serial).toEqual({ start: 100 });

    // @ts-expect-error serial() can only be called on string or integer fields
    db.bool().serial({ start: 0 });
    // @ts-expect-error serial() cannot be called on array fields
    db.string({ array: true }).serial({ start: 0 });
  });

  test("calling serial modifier more than once causes type error", () => {
    // @ts-expect-error serial() cannot be called after serial() has already been called
    db.string().serial({ start: 0 }).serial({ start: 0 });
  });
});

describe("TailorDBField index modifier tests", () => {
  test("index modifier cannot be called on array fields", () => {
    const _indexed = db.string().index();
    expect(_indexed.metadata.index).toBe(true);

    // @ts-expect-error index() cannot be called on array fields
    db.string({ array: true }).index();
    // @ts-expect-error index() cannot be called on array fields
    db.uuid({ array: true }).index();
    // @ts-expect-error index() cannot be called on array fields
    db.int({ array: true }).index();
  });

  test("calling index modifier more than once causes type error", () => {
    // @ts-expect-error index() cannot be called after index() has already been called
    db.string().index().index();
  });
});

describe("TailorDBField unique modifier tests", () => {
  test("unique modifier cannot be called on array fields", () => {
    const _unique = db.string().unique();
    expect(_unique.metadata.unique).toBe(true);
    expect(_unique.metadata.index).toBe(true);

    // @ts-expect-error unique() cannot be called on array fields
    db.string({ array: true }).unique();
    // @ts-expect-error unique() cannot be called on array fields
    db.uuid({ array: true }).unique();
    // @ts-expect-error unique() cannot be called on array fields
    db.int({ array: true }).unique();
  });

  test("calling unique modifier more than once causes type error", () => {
    // @ts-expect-error unique() cannot be called after unique() has already been called
    db.string().unique().unique();
  });
});

describe("TailorDBType withTimestamps option tests", () => {
  test("withTimestamps: true adds timestamp fields", () => {
    const _timestampType = db.table("TestWithTimestamp", {
      name: db.string(),
      ...db.fields.timestamps(),
    });
    expectTypeOf<output<typeof _timestampType>>().toEqualTypeOf<{
      id: string;
      name: string;
      createdAt: string | Date;
      updatedAt: string | Date;
    }>();
  });

  const timestampHookInvoker = null;

  test("createdAt create hook respects a user-specified value", () => {
    const { createdAt } = db.fields.timestamps();
    const createHook = createdAt.metadata.hooks?.create;
    expect(createHook).toBeDefined();

    const specified = new Date("2025-02-10T09:00:00Z");
    const result = createHook!({ value: specified, data: {}, invoker: timestampHookInvoker });
    expect(result).toBe(specified);
  });

  test("createdAt create hook falls back to now when no value is given", () => {
    const { createdAt } = db.fields.timestamps();
    const createHook = createdAt.metadata.hooks?.create;
    expect(createHook).toBeDefined();

    const before = Date.now();
    const result = createHook!({ value: null, data: {}, invoker: timestampHookInvoker });
    const after = Date.now();
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((result as Date).getTime()).toBeLessThanOrEqual(after);
  });

  test("updatedAt create hook respects a user-specified value", () => {
    const { updatedAt } = db.fields.timestamps();
    const createHook = updatedAt.metadata.hooks?.create;
    expect(createHook).toBeDefined();

    const specified = new Date("2025-02-10T09:00:00Z");
    const result = createHook!({ value: specified, data: {}, invoker: timestampHookInvoker });
    expect(result).toBe(specified);
  });

  test("updatedAt create hook falls back to now when no value is given", () => {
    const { updatedAt } = db.fields.timestamps();
    const createHook = updatedAt.metadata.hooks?.create;
    expect(createHook).toBeDefined();

    const before = Date.now();
    const result = createHook!({ value: null, data: {}, invoker: timestampHookInvoker });
    const after = Date.now();
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((result as Date).getTime()).toBeLessThanOrEqual(after);
  });

  test("updatedAt update hook uses current time", () => {
    const { updatedAt } = db.fields.timestamps();
    const updateHook = updatedAt.metadata.hooks?.update;
    expect(updateHook).toBeDefined();

    const before = Date.now();
    const result = updateHook!({ value: null, data: {}, invoker: timestampHookInvoker });
    const after = Date.now();
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((result as Date).getTime()).toBeLessThanOrEqual(after);
  });
});

describe("TailorDBType composite type tests", () => {
  test("type with multiple fields works correctly", () => {
    const _complexType = db.table("User", {
      name: db.string(),
      email: db.string(),
      age: db.int({ optional: true }),
      isActive: db.bool(),
      tags: db.string({ array: true }),
      role: db.enum(["admin", "user", "guest"]),
      score: db.float(),
      birthDate: db.date(),
      lastLogin: db.datetime({ optional: true }),
      closingTime: db.time(),
    });
    expectTypeOf<output<typeof _complexType>>().toMatchObjectType<{
      id: string;
      name: string;
      email: string;
      age?: number | null;
      isActive: boolean;
      tags: string[];
      role: "admin" | "user" | "guest";
      score: number;
      birthDate: string;
      lastLogin?: string | Date | null;
      closingTime: string;
    }>();
  });
});

describe("TailorDBType edge case tests", () => {
  test("type with single field works correctly", () => {
    const _singleFieldType = db.table("Simple", {
      value: db.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      id: string;
      value: string;
    }>();
  });

  test("type with all optional fields works correctly", () => {
    const _allOptionalType = db.table("Optional", {
      a: db.string({ optional: true }),
      b: db.int({ optional: true }),
      c: db.bool({ optional: true }),
    });
    expectTypeOf<output<typeof _allOptionalType>>().toEqualTypeOf<{
      id: string;
      a?: string | null;
      b?: number | null;
      c?: boolean | null;
    }>();
  });

  test("type with all array fields works correctly", () => {
    const _allArrayType = db.table("Array", {
      strings: db.string({ array: true }),
      numbers: db.int({ array: true }),
      booleans: db.bool({ array: true }),
    });
    expectTypeOf<output<typeof _allArrayType>>().toEqualTypeOf<{
      id: string;
      strings: string[];
      numbers: number[];
      booleans: boolean[];
    }>();
  });
});

describe("TailorDBType type consistency tests", () => {
  test("same definition generates same type", () => {
    const _type1 = db.table("Same", {
      name: db.string(),
      age: db.int(),
    });
    const _type2 = db.table("Same", {
      name: db.string(),
      age: db.int(),
    });
    expectTypeOf<output<typeof _type1>>().toEqualTypeOf<output<typeof _type2>>();
  });

  test("id field is automatically added", () => {
    const _typeWithoutId = db.table("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _typeWithoutId>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });
});

describe("TailorDBType self relation tests", () => {
  test("when toward.type is self, rawRelation stores the config (processing happens in parser layer)", () => {
    const TestType = db.table("TestType", {
      name: db.string(),
      parentID: db.uuid().relation({
        type: "n-1",
        toward: { type: "self" },
        backward: "children",
      }),
      dependId: db.uuid().relation({
        type: "1-1",
        toward: { type: "self", as: "dependsOn" },
        backward: "dependedBy",
      }),
      keyID: db.uuid().relation({
        type: "keyOnly",
        toward: { type: "self" },
      }),
    });

    // Raw relation config is stored (reference was removed, only rawRelation exists)
    const parentRaw = TestType.fields.parentID.rawRelation!;
    expect(parentRaw.toward.type).toBe("self");
    expect(parentRaw.type).toBe("n-1");
    expect(parentRaw.backward).toBe("children");

    const dependRaw = TestType.fields.dependId.rawRelation!;
    expect(dependRaw.toward.type).toBe("self");
    expect(dependRaw.toward.as).toBe("dependsOn");
    expect(dependRaw.type).toBe("1-1");
    expect(dependRaw.backward).toBe("dependedBy");

    const keyRaw = TestType.fields.keyID.rawRelation!;
    expect(keyRaw.toward.type).toBe("self");
    expect(keyRaw.type).toBe("keyOnly");
  });

  test("when backward is not specified, undefined is stored in rawRelation (inflection happens in parser layer)", () => {
    const A = db.table("Node", {
      // Many-to-one (non-unique): backward is plural (nodes)
      parentID: db.uuid().relation({ type: "n-1", toward: { type: "self" } }),
      // One-to-one (unique): backward is singular (node)
      pairId: db.uuid().relation({ type: "1-1", toward: { type: "self" } }),
    });

    // rawRelation stores the config, backward is undefined when not specified
    expect(A.fields.parentID.rawRelation!.toward.type).toBe("self");
    expect(A.fields.parentID.rawRelation!.backward).toBeUndefined();
    expect(A.fields.pairId.rawRelation!.toward.type).toBe("self");
    expect(A.fields.pairId.rawRelation!.backward).toBeUndefined();
  });
});

describe("TailorDBType plural form tests", () => {
  test("when defining type with single name, pluralForm is not set in configure (inflection is executed at parser layer)", () => {
    const _userType = db.table("User", {
      name: db.string(),
    });

    expect(_userType.metadata.settings?.pluralForm).toBeUndefined();
  });

  test("when specifying name and plural form as tuple, pluralForm is set", () => {
    const _personType = db.table(["Person", "People"], {
      name: db.string(),
    });

    expect(_personType.metadata.settings?.pluralForm).toBe("People");
  });

  test("when plural form is empty string, it is not set in configure (inflection is executed at parser layer)", () => {
    const _dataType = db.table(["Datum", ""], {
      value: db.string(),
    });

    expect(_dataType.metadata.settings?.pluralForm).toBeUndefined();
  });

  test("error when plural form is same as name (when explicitly specified in tuple format)", () => {
    expect(() => db.table(["Data", "Data"], {})).toThrowError(
      "The name and the plural form must be different. name=Data",
    );
  });

  test.each([
    ["Child", "Children"],
    ["Device", "Device's"],
    ["Item", "100Items"],
    ["Data", "DataSet"],
  ])("plural form %s/%s can be set via tuple format", (name, pluralForm) => {
    const _type = db.table([name, pluralForm], {
      value: db.string(),
    });

    expect(_type.metadata.settings?.pluralForm).toBe(pluralForm);
  });

  test("all existing features work correctly with tuple format", () => {
    const _postType = db.table(["Post", "Posts"], {
      title: db.string(),
      content: db.string({ optional: true }),
      ...db.fields.timestamps(),
    });

    expectTypeOf<output<typeof _postType>>().toEqualTypeOf<{
      id: string;
      title: string;
      content?: string | null;
      createdAt: string | Date;
      updatedAt: string | Date;
    }>();

    expect(_postType.name).toBe("Post");
    expect(_postType.metadata.settings?.pluralForm).toBe("Posts");
  });

  test("validation and plural form coexist in tuple format", () => {
    const _userType = db
      .table(["User", "Users"], {
        name: db.string(),
        email: db.string(),
      })
      .validate({
        name: [({ value }) => value.length > 0],
        email: [({ value }) => value.includes("@"), "Invalid email format"],
      });

    expect(_userType.name).toBe("User");
    expect(_userType.metadata.settings?.pluralForm).toBe("Users");

    // Validate that the validation function is stored correctly in metadata
    const emailMetadata = _userType.fields.email.metadata;
    expect(emailMetadata.validate).toBeDefined();
    expect(emailMetadata.validate).toHaveLength(1);
  });

  test("plural form works correctly for types with relations", () => {
    const _categoryType = db.table(["Category", "Categories"], {
      name: db.string(),
    });

    const _productType = db.table(["Product", "Products"], {
      name: db.string(),
      categoryId: db.uuid().relation({
        type: "oneToOne",
        toward: { type: _categoryType },
      }),
    });

    expect(_categoryType.metadata.settings?.pluralForm).toBe("Categories");
    expect(_productType.metadata.settings?.pluralForm).toBe("Products");
  });
});

describe("TailorDBType hooks modifier tests", () => {
  test("hooks modifier does not affect output type", () => {
    const _hookType = db
      .table("Test", {
        name: db.string(),
      })
      .hooks({
        name: {
          create: () => "created",
          update: () => "updated",
        },
      });
    expectTypeOf<output<typeof _hookType>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  test("setting hooks on id causes type error", () => {
    db.table("Test", {
      name: db.string(),
    }).hooks({
      // @ts-expect-error hooks() cannot be called on the "id" field
      id: {
        create: () => "created",
      },
    });
  });

  test("setting hooks on nested field causes type error", () => {
    db.table("Test", {
      name: db.object({
        first: db.string(),
        last: db.string(),
      }),
      // @ts-expect-error hooks() cannot be called on nested fields
    }).hooks({
      name: {
        create: () => "created",
      },
    });
  });

  test("hooks modifier on string field receives string", () => {
    const testType = db.table("Test", { name: db.string() });
    const _hooks = testType.hooks;
    type ExpectedHooksParam = Parameters<typeof _hooks>[0];
    type ActualNameType = Exclude<ExpectedHooksParam["name"], undefined>;

    expectTypeOf<ActualNameType>().toEqualTypeOf<
      Hook<
        {
          id: string;
          readonly name: string;
        },
        string
      >
    >();
  });

  test("hooks modifier on optional field receives null", () => {
    const testType = db.table("Test", {
      name: db.string({ optional: true }),
    });
    const _hooks = testType.hooks;
    type ExpectedHooksParam = Parameters<typeof _hooks>[0];
    type ActualNameType = Exclude<ExpectedHooksParam["name"], undefined>;

    expectTypeOf<ActualNameType>().toEqualTypeOf<
      Hook<
        {
          id: string;
          name?: string | null;
        },
        string | null
      >
    >();
  });
});

describe("TailorDBType validate modifier tests", () => {
  test("validate modifier can receive function", () => {
    const _validateType = db
      .table("Test", {
        email: db.string(),
      })
      .validate({
        email: () => true,
      });

    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
    const fieldMetadata = _validateType.fields.email.metadata;
    expect(fieldMetadata.validate).toHaveLength(1);
  });

  test("validate modifier can receive object with message", () => {
    const _validateType = db
      .table("Test", {
        email: db.string(),
      })
      .validate({
        email: [({ value }) => value.includes("@"), "Email must contain @"],
      });

    const fieldMetadata = _validateType.fields.email.metadata;
    expect(fieldMetadata.validate).toHaveLength(1);
    // Validator is a tuple [fn, errorMessage]
    expect((fieldMetadata.validate?.[0] as [unknown, string])[1]).toBe("Email must contain @");
  });

  test("validate modifier can receive multiple validators", () => {
    const _validateType = db
      .table("Test", {
        password: db.string(),
      })
      .validate({
        password: [
          ({ value }) => value.length >= 8,
          [({ value }) => /[A-Z]/.test(value), "Password must contain uppercase letter"],
        ],
      });

    const fieldMetadata = _validateType.fields.password.metadata;
    expect(fieldMetadata.validate).toHaveLength(2);
    // Second validator is a tuple [fn, errorMessage]
    expect((fieldMetadata.validate?.[1] as [unknown, string])[1]).toBe(
      "Password must contain uppercase letter",
    );
  });

  test("type error occurs when validate is already set on TailorDBField", () => {
    db.table("Test", {
      name: db.string().validate(() => true),
      // @ts-expect-error validate() cannot be called after validate() has already been called
    }).validate({
      name: () => true,
    });
  });

  test("setting validate on id causes type error", () => {
    db.table("Test", {
      name: db.string(),
    }).validate({
      // @ts-expect-error validate() cannot be called on the "id" field
      id: () => true,
    });
  });

  test("validate modifier on string field receives string", () => {
    const _validate = db.table("Test", { name: db.string() }).validate;
    expectTypeOf<ValidateConfig<string, { id: string; name: string }>>().toExtend<
      Parameters<typeof _validate>[0]["name"]
    >();
  });

  test("validate modifier on optional field receives null", () => {
    const _validate = db.table("Test", {
      name: db.string({ optional: true }),
    }).validate;
    expectTypeOf<ValidateConfig<string | null, { id: string; name?: string | null }>>().toExtend<
      Parameters<typeof _validate>[0]["name"]
    >();
  });
});

describe("db.object tests", () => {
  test("correctly infers basic object type", () => {
    const _objectType = db.table("Test", {
      user: db.object({
        name: db.string(),
        age: db.int(),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      user: {
        name: string;
        age: number;
      };
    }>();
  });

  test("nesting db.object causes type error", () => {
    db.object({
      name: db.string(),
      // @ts-expect-error Nested db.object() is not allowed
      profile: db.object({
        bio: db.string(),
      }),
    });
  });

  test("correctly infers object type with optional fields", () => {
    const _objectType = db.table("Test", {
      user: db.object({
        name: db.string(),
        age: db.int({ optional: true }),
        email: db.string({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      user: {
        name: string;
        age?: number | null;
        email?: string | null;
      };
    }>();
  });

  test("correctly infers object type with optional option", () => {
    const _objectType = db.table("Test", {
      user: db.object(
        {
          name: db.string(),
          avatar: db.string({ optional: true }),
        },
        { optional: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      user?: {
        name: string;
        avatar?: string | null;
      } | null;
    }>();
  });

  test("correctly infers object type with array option", () => {
    const _objectType = db.table("Test", {
      users: db.object(
        {
          name: db.string(),
          age: db.int(),
        },
        { array: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      users: {
        name: string;
        age: number;
      }[];
    }>();
  });

  test("correctly infers object type with array fields", () => {
    const _objectType = db.table("Test", {
      user: db.object({
        name: db.string(),
        tags: db.string({ array: true }),
        scores: db.int({ array: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      user: {
        name: string;
        tags: string[];
        scores: number[];
      };
    }>();
  });

  test("correctly infers object type with multiple modifiers", () => {
    const _objectType = db.table("Test", {
      optionalUsers: db.object(
        {
          name: db.string(),
          age: db.int({ optional: true }),
          tags: db.string({ array: true }),
        },
        { optional: true, array: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      optionalUsers?:
        | {
            name: string;
            age?: number | null;
            tags: string[];
          }[]
        | null;
    }>();
  });

  test("correctly infers object type with bool type", () => {
    const _objectType = db.table("Test", {
      settings: db.object({
        enabled: db.bool(),
        push: db.bool({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      settings: {
        enabled: boolean;
        push?: boolean | null;
      };
    }>();
  });

  test("correctly infers object type with float and enum types", () => {
    const _objectType = db.table("Test", {
      product: db.object({
        name: db.string(),
        price: db.float(),
        category: db.enum(["electronics", "books", "clothing"]),
        weight: db.float({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      product: {
        name: string;
        price: number;
        category: "electronics" | "books" | "clothing";
        weight?: number | null;
      };
    }>();
  });
});

describe("TailorField/TailorType compatibility tests", () => {
  test("can use TailorDBField inside t.type", () => {
    const _stringType = t.object({
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      name: string;
    }>();
  });
});

describe("TailorDBType/TailorDBField description support", () => {
  test("TailorDBField supports description", () => {
    const userType = db.table("User", {
      name: db.string().description("User name"),
      age: db.int().description("User age"),
    });

    expect(userType.fields.name.metadata.description).toBe("User name");
    expect(userType.fields.age.metadata.description).toBe("User age");
  });

  test("TailorDBType description is set via second argument", () => {
    const userType = db.table("User", "User profile type", {
      name: db.string(),
    });

    expect(userType._description).toBe("User profile type");
  });

  test("TailorDBField nested object supports description", () => {
    const profileType = db.table("Profile", {
      userInfo: db
        .object({
          name: db.string().description("Full name"),
          email: db.string().description("Email address"),
        })
        .description("User information object"),
    });

    expect(profileType.fields.userInfo!.metadata.description).toBe("User information object");
    expect(profileType.fields.userInfo!.fields.name!.metadata.description).toBe("Full name");
    expect(profileType.fields.userInfo!.fields.email!.metadata.description).toBe("Email address");
  });

  test("TailorDBType can be used in resolver with description preserved", () => {
    const userType = db.table("User", "User type for resolver", {
      name: db.string().description("User name"),
      email: db.string().description("User email"),
    });

    // TailorDBType extends TailorType, so it should have _description
    // Type check removed - TailorType no longer exists
    expect(userType._description).toBe("User type for resolver");
    expect(userType.fields.name.metadata.description).toBe("User name");
    expect(userType.fields.email.metadata.description).toBe("User email");
  });
});

describe("TailorDBField fluent API type preservation", () => {
  test("description() preserves _output type", () => {
    const _field = db.string().description("A name field");
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<string>();
  });

  test("description() on optional field preserves nullable type", () => {
    const _field = db.string({ optional: true }).description("Optional field");
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<string | null>();
  });

  test("description() on array field preserves array type", () => {
    const _field = db.string({ array: true }).description("Array field");
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<string[]>();
  });

  test("multiple method chain preserves type", () => {
    const _field = db
      .string()
      .description("Email address")
      .index()
      .validate(({ value }) => value.includes("@"));
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<string>();
  });

  test("chained methods on optional field preserve nullable type", () => {
    const _field = db.int({ optional: true }).description("Optional count").index();
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<number | null>();
  });

  test("relation() preserves uuid type", () => {
    const User = db.table("User", { name: db.string() });
    const _field = db
      .uuid()
      .description("User reference")
      .relation({ type: "n-1", toward: { type: User } });
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<string>();
  });
});

describe("TailorDBType files method tests", () => {
  test("files method adds file fields to metadata", () => {
    const userType = db
      .table("User", {
        name: db.string(),
      })
      .files({
        avatar: "profile image",
        document: "user document",
      });

    expect(userType.metadata.files).toEqual({
      avatar: "profile image",
      document: "user document",
    });
  });

  test("files field names cannot conflict with existing field names (type error)", () => {
    const _userType = db.table("User", {
      name: db.string(),
      avatar: db.string(), // existing field
    });

    type FilesParam = Parameters<typeof _userType.files>[0];
    expectTypeOf<FilesParam>().toExtend<{
      avatar?: TypeLevelError<"file keys cannot use existing field names">;
    }>();
    expectTypeOf<FilesParam>().not.toExtend<{
      nonExists?: TypeLevelError<"file keys cannot use existing field names">;
    }>();

    // @ts-expect-error file keys cannot use existing field names
    _userType.files({ avatar: "profile image" });
  });

  test("files field names that do not conflict are allowed", () => {
    const _userType = db.table("User", {
      name: db.string(),
    });

    type FilesParam = Parameters<typeof _userType.files>[0];
    // "avatar" is not an existing field, so it should be allowed
    expectTypeOf<{ avatar: string }>().toExtend<FilesParam>();
    expectTypeOf<{ avatar?: never }>().not.toExtend<FilesParam>();
  });
});

describe("TailorDBField runtime validation tests", () => {
  const invoker: TailorPrincipal = {
    id: "test",
    type: "user",
    workspaceId: "workspace-test",
    attributes: {},
    attributeList: [],
  };
  const data = {};

  function expectParsedValue<T>(result: StandardSchemaV1.Result<T>, expected: T) {
    expect(result.issues).toBeUndefined();
    if (result.issues) {
      throw new Error("Unexpected issues");
    }
    expect(result.value).toEqual(expected);
  }

  test("validates string field values", () => {
    const field = db.string();
    expectParsedValue(field.parse({ value: "hello", data, invoker }), "hello");

    const bad = field.parse({ value: 123, data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a string: received 123");
  });

  test("validates enum values", () => {
    const field = db.enum(["active", "inactive"]);
    expectParsedValue(field.parse({ value: "active", data, invoker }), "active");

    const bad = field.parse({ value: "unknown", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Must be one of [active, inactive]: received unknown");
  });

  test("validates integer values", () => {
    const field = db.int();
    expectParsedValue(field.parse({ value: 42, data, invoker }), 42);

    const bad = field.parse({ value: "not-a-number", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected an integer: received not-a-number");
  });

  test("validates float values", () => {
    const field = db.float();
    expectParsedValue(field.parse({ value: 3.14, data, invoker }), 3.14);

    const bad = field.parse({ value: "not-a-number", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a number: received not-a-number");
  });

  test("validates boolean values", () => {
    const field = db.bool();
    expectParsedValue(field.parse({ value: true, data, invoker }), true);

    const bad = field.parse({ value: "true", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a boolean: received true");
  });

  test("validates nested object values", () => {
    const field = db.object({
      name: db.string(),
      age: db.int({ optional: true }),
    });
    expectParsedValue(field.parse({ value: { name: "test", age: 30 }, data, invoker }), {
      name: "test",
      age: 30,
    });

    const bad = field.parse({ value: { name: 123 }, data, invoker });
    expect(bad.issues?.[0]?.path).toEqual(["name"]);
    expect(bad.issues?.[0]?.message).toBe("Expected a string: received 123");
  });

  test("validates array values", () => {
    const field = db.int({ array: true });
    expectParsedValue(field.parse({ value: [1, 2, 3], data, invoker }), [1, 2, 3]);
  });

  test("validates UUID format", () => {
    const field = db.uuid();
    expectParsedValue(
      field.parse({ value: "123e4567-e89b-12d3-a456-426614174000", data, invoker }),
      "123e4567-e89b-12d3-a456-426614174000",
    );

    const bad = field.parse({ value: "not-a-uuid", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a valid UUID: received not-a-uuid");
  });

  test("validates date format", () => {
    const field = db.date();
    expectParsedValue(field.parse({ value: "2025-01-01", data, invoker }), "2025-01-01");

    const bad = field.parse({ value: "2025/01/01", data, invoker });
    expect(bad.issues?.[0]?.message).toBe(
      'Expected to match "yyyy-MM-dd" format: received 2025/01/01',
    );
  });

  test("validates time format", () => {
    const field = db.time();
    expectParsedValue(field.parse({ value: "10:11", data, invoker }), "10:11");

    const bad = field.parse({ value: "10:11:12", data, invoker });
    expect(bad.issues?.[0]?.message).toBe('Expected to match "HH:mm" format: received 10:11:12');
  });

  test("validates required and optional handling", () => {
    const requiredField = db.string();
    const requiredMissing = requiredField.parse({ value: undefined, data, invoker });
    expect(requiredMissing.issues?.[0]?.message).toBe("Required field is missing");

    const optionalField = db.string({ optional: true });
    expectParsedValue(optionalField.parse({ value: undefined, data, invoker }), null);
  });
});

describe("TailorDBType gqlOperations tests", () => {
  test("gqlOperations stores raw config via features()", () => {
    const orderType = db
      .table("Order", {
        name: db.string(),
      })
      .features({
        gqlOperations: {
          delete: false,
        },
      });

    // Configure layer stores raw data without normalization
    const ops = orderType.metadata.settings?.gqlOperations;
    expect(ops).toEqual({ delete: false });
  });

  test("gqlOperations stores multiple operations config", () => {
    const archiveType = db
      .table("Archive", {
        data: db.string(),
      })
      .features({
        gqlOperations: {
          create: false,
          update: false,
          delete: false,
        },
      });

    const ops = archiveType.metadata.settings?.gqlOperations;
    expect(ops).toEqual({ create: false, update: false, delete: false });
  });

  test("gqlOperations stores read config", () => {
    const secretType = db
      .table("Secret", {
        value: db.string(),
      })
      .features({
        gqlOperations: {
          read: false,
        },
      });

    const ops = secretType.metadata.settings?.gqlOperations;
    expect(ops).toEqual({ read: false });
  });

  test("gqlOperations works with other features", () => {
    const logType = db
      .table("Log", {
        message: db.string(),
      })
      .features({
        aggregation: true,
        bulkUpsert: true,
        gqlOperations: {
          delete: false,
        },
      });

    expect(logType.metadata.settings?.aggregation).toBe(true);
    expect(logType.metadata.settings?.bulkUpsert).toBe(true);
    expect(logType.metadata.settings?.gqlOperations).toEqual({ delete: false });
  });
});

describe("TailorDBType gqlOperations alias tests", () => {
  test("gqlOperations: 'query' stores alias as raw value", () => {
    const readOnlyType = db
      .table("ReadOnly", {
        data: db.string(),
      })
      .features({
        gqlOperations: "query",
      });

    // Configure layer stores the alias without normalization
    const ops = readOnlyType.metadata.settings?.gqlOperations;
    expect(ops).toBe("query");
  });

  test("gqlOperations: 'query' works with other features", () => {
    const auditType = db
      .table("Audit", {
        action: db.string(),
      })
      .features({
        aggregation: true,
        gqlOperations: "query",
      });

    expect(auditType.metadata.settings?.aggregation).toBe(true);
    expect(auditType.metadata.settings?.gqlOperations).toBe("query");
  });
});

describe("TailorDBField immutability", () => {
  test("field.hooks() returns a new field without mutating the original", () => {
    const original = db.string();
    const withHooks = original.hooks({ create: () => "created" });

    // hooks() should return a NEW field
    expect(withHooks).not.toBe(original);
    // Original should NOT have hooks
    expect(original.metadata.hooks).toBeUndefined();
    // New field should have hooks
    expect(withHooks.metadata.hooks?.create).toBeDefined();
  });

  test("field.validate() returns a new field without mutating the original", () => {
    const original = db.string();
    const withValidate = original.validate(({ value }) => value.length > 0);

    expect(withValidate).not.toBe(original);
    expect(original.metadata.validate).toBeUndefined();
    expect(withValidate.metadata.validate).toHaveLength(1);
  });

  test("field.description() returns a new field without mutating the original", () => {
    const original = db.string();
    const withDesc = original.description("desc");

    expect(withDesc).not.toBe(original);
    expect(original.metadata.description).toBeUndefined();
    expect(withDesc.metadata.description).toBe("desc");
  });

  test("field.index() returns a new field without mutating the original", () => {
    const original = db.string();
    const withIndex = original.index();

    expect(withIndex).not.toBe(original);
    expect(original.metadata.index).toBeUndefined();
    expect(withIndex.metadata.index).toBe(true);
  });

  test("field.unique() returns a new field without mutating the original", () => {
    const original = db.string();
    const withUnique = original.unique();

    expect(withUnique).not.toBe(original);
    expect(original.metadata.unique).toBeUndefined();
    expect(withUnique.metadata.unique).toBe(true);
  });

  test("field.serial() returns a new field without mutating the original", () => {
    const original = db.int();
    const withSerial = original.serial({ start: 1 });

    expect(withSerial).not.toBe(original);
    expect(original.metadata.serial).toBeUndefined();
    expect(withSerial.metadata.serial).toEqual({ start: 1 });
  });

  test("field.vector() returns a new field without mutating the original", () => {
    const original = db.string();
    const withVector = original.vector();

    expect(withVector).not.toBe(original);
    expect(original.metadata.vector).toBeUndefined();
    expect(withVector.metadata.vector).toBe(true);
  });

  test("field.relation() returns a new field without mutating the original", () => {
    const User = db.table("User", { name: db.string() });
    const original = db.uuid();
    const withRelation = original.relation({ type: "n-1", toward: { type: User } });

    expect(withRelation).not.toBe(original);
    expect(original.rawRelation).toBeUndefined();
    expect(withRelation.rawRelation).toBeDefined();
  });

  test("chained fluent calls produce correct result", () => {
    const field = db
      .string()
      .description("name")
      .index()
      .hooks({ create: () => "x" });

    expect(field.metadata.description).toBe("name");
    expect(field.metadata.index).toBe(true);
    expect(field.metadata.hooks?.create).toBeDefined();
  });
});

describe("TailorDBType does not mutate shared fields", () => {
  test("type.hooks() does not mutate the shared field", () => {
    const sharedField = db.string();

    const typeA = db.table("TypeA", { name: sharedField }).hooks({ name: { create: () => "A" } });
    const typeB = db.table("TypeB", { name: sharedField });

    expect(typeA.fields.name.metadata.hooks).toBeDefined();
    expect(typeB.fields.name.metadata.hooks).toBeUndefined();
    expect(sharedField.metadata.hooks).toBeUndefined();
  });

  test("type.validate() does not mutate the shared field", () => {
    const sharedField = db.string();

    const typeA = db
      .table("TypeA", { email: sharedField })
      .validate({ email: ({ value }) => value.includes("@") });
    const typeB = db.table("TypeB", { email: sharedField });

    expect(typeA.fields.email.metadata.validate).toBeDefined();
    expect(typeB.fields.email.metadata.validate).toBeUndefined();
    expect(sharedField.metadata.validate).toBeUndefined();
  });

  test("hooks() does not replace entries in the original fields record", () => {
    const nameField = db.string();
    const fields = { name: nameField };

    db.table("TypeA", fields).hooks({ name: { create: () => "hooked" } });

    // The fields record should still reference the original field instance
    expect(fields.name).toBe(nameField);
  });

  test("validate() does not replace entries in the original fields record", () => {
    const emailField = db.string();
    const fields = { email: emailField };

    db.table("TypeA", fields).validate({ email: ({ value }) => value.includes("@") });

    // The fields record should still reference the original field instance
    expect(fields.email).toBe(emailField);
  });
});

describe("TailorDBField clone tests", () => {
  test("clones field with same metadata", () => {
    const original = db.string().description("test description").index();
    const cloned = original.clone();

    expect(cloned.metadata.description).toBe("test description");
    expect(cloned.metadata.index).toBe(true);
    expect(cloned.metadata.required).toBe(true);
  });

  test("cloned field is independent from original", () => {
    const original = db.string().description("original");
    const cloned = original.clone();

    // Modifying cloned should not affect original
    expect(cloned.metadata.description).toBe("original");
    expect(original.metadata.description).toBe("original");
  });

  test("clone with optional override changes required to false", () => {
    const required = db.string();
    expect(required.metadata.required).toBe(true);

    const optional = required.clone({ optional: true });
    expect(optional.metadata.required).toBe(false);

    // Original remains unchanged
    expect(required.metadata.required).toBe(true);
  });

  test("clone with array override", () => {
    const single = db.int();
    const array = single.clone({ array: true });

    expect(array.metadata.array).toBe(true);
    expectTypeOf<output<typeof array>>().toEqualTypeOf<number[]>();
  });

  test("clone preserves enum value output type", () => {
    const original = db.enum(["active", "inactive"], { array: true });
    const cloned = original.clone();

    expect(cloned.metadata.array).toBe(true);
    expectTypeOf<output<typeof cloned>>().toEqualTypeOf<("active" | "inactive")[]>();
  });

  test("clone preserves existing optional output when overriding array", () => {
    const original = db.object({ name: db.string() }, { optional: true });
    const cloned = original.clone({ array: true });

    expect(cloned.metadata.required).toBe(false);
    expect(cloned.metadata.array).toBe(true);
    expectTypeOf<output<typeof cloned>>().toEqualTypeOf<{ name: string }[] | null>();
  });

  test("clone with both optional and array overrides", () => {
    const original = db.string();
    const cloned = original.clone({ optional: true, array: true });

    expect(cloned.metadata.required).toBe(false);
    expect(cloned.metadata.array).toBe(true);
    expectTypeOf<output<typeof cloned>>().toEqualTypeOf<string[] | null>();
  });

  test("pickFields with options preserves field output base type", () => {
    const User = db.table("User", {
      role: db.enum(["admin", "member"]),
      profile: db.object({ name: db.string() }, { optional: true }),
    });

    const picked = User.pickFields(["role", "profile"], { array: true });

    expectTypeOf<output<(typeof picked)["role"]>>().toEqualTypeOf<("admin" | "member")[]>();
    expectTypeOf<output<(typeof picked)["profile"]>>().toEqualTypeOf<{ name: string }[] | null>();
  });

  test("clones unique modifier correctly", () => {
    const original = db.string().unique();
    const cloned = original.clone();

    expect(cloned.metadata.unique).toBe(true);
    expect(cloned.metadata.index).toBe(true);
  });

  test("clones relation config correctly", () => {
    const User = db.table("User", { name: db.string() });
    const original = db.uuid().relation({
      type: "n-1",
      toward: { type: User, as: "author" },
      backward: "posts",
    });
    const cloned = original.clone();

    expect(cloned.rawRelation).toBeDefined();
    expect(cloned.rawRelation?.type).toBe("n-1");
    expect(cloned.rawRelation?.toward.type).toBe("User");
    expect(cloned.rawRelation?.toward.as).toBe("author");
    expect(cloned.rawRelation?.backward).toBe("posts");

    // Verify deep copy (different reference)
    expect(cloned.rawRelation).not.toBe(original.rawRelation);
    expect(cloned.rawRelation?.toward).not.toBe(original.rawRelation?.toward);
  });

  test("clones hooks correctly", () => {
    const createHook = () => "created";
    const original = db.string().hooks({ create: createHook });
    const cloned = original.clone();

    expect(cloned.metadata.hooks).toBeDefined();
    expect(cloned.metadata.hooks?.create).toBe(createHook);

    // Verify deep copy (different reference)
    expect(cloned.metadata.hooks).not.toBe(original.metadata.hooks);
  });

  test("clones validate correctly", () => {
    const validator = ({ value }: { value: string }) => value.length > 0;
    const original = db.string().validate(validator);
    const cloned = original.clone();

    expect(cloned.metadata.validate).toBeDefined();
    expect(cloned.metadata.validate).toHaveLength(1);

    // Verify deep copy (different reference)
    expect(cloned.metadata.validate).not.toBe(original.metadata.validate);
  });

  test("clones validate with tuple format correctly", () => {
    const validator = ({ value }: { value: string }) => value.length > 0;
    const original = db.string().validate([validator, "Value must not be empty"]);
    const cloned = original.clone();

    expect(cloned.metadata.validate).toBeDefined();
    expect(cloned.metadata.validate).toHaveLength(1);
    expect(cloned.metadata.validate?.[0]).toEqual([validator, "Value must not be empty"]);

    // Verify deep copy (different reference for array and tuple)
    expect(cloned.metadata.validate).not.toBe(original.metadata.validate);
    expect(cloned.metadata.validate?.[0]).not.toBe(original.metadata.validate?.[0]);
  });

  test("clones serial config correctly", () => {
    const original = db.int().serial({ start: 100 });
    const cloned = original.clone();

    expect(cloned.metadata.serial).toEqual({ start: 100 });

    // Verify deep copy (different reference)
    expect(cloned.metadata.serial).not.toBe(original.metadata.serial);
  });

  test("clones vector config correctly", () => {
    const original = db.string().vector();
    const cloned = original.clone();

    expect(cloned.metadata.vector).toBe(true);
  });

  test("clones enum field correctly", () => {
    const original = db.enum(["active", "inactive", "pending"]);
    const cloned = original.clone();

    expect(cloned.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);

    // Verify deep copy (different reference)
    expect(cloned.metadata.allowedValues).not.toBe(original.metadata.allowedValues);
    expect(cloned.metadata.allowedValues?.[0]).not.toBe(original.metadata.allowedValues?.[0]);
  });

  test("clones nested object field correctly", () => {
    const original = db.object({
      name: db.string(),
      age: db.int({ optional: true }),
    });
    const cloned = original.clone();

    expect(cloned.fields.name).toBeDefined();
    expect(cloned.fields.age).toBeDefined();

    // Verify deep copy (different reference)
    expect(cloned.fields).not.toBe(original.fields);
    expect(cloned.fields.name).not.toBe(original.fields.name);
    expect(cloned.fields.age).not.toBe(original.fields.age);
  });
});

describe("TailorDBField decimal type tests", () => {
  test("decimal field outputs string type correctly", () => {
    const _decimalType = db.table("Test", {
      price: db.decimal(),
    });
    expectTypeOf<output<typeof _decimalType>>().toEqualTypeOf<{
      id: string;
      price: string;
    }>();
  });

  test("optional decimal field outputs string | null type correctly", () => {
    const _decimalType = db.table("Test", {
      discount: db.decimal({ optional: true }),
    });
    expectTypeOf<output<typeof _decimalType>>().toEqualTypeOf<{
      id: string;
      discount?: string | null;
    }>();
  });

  test("decimal with scale stores scale in metadata", () => {
    const field = db.decimal({ scale: 2 });
    expect(field.type).toBe("decimal");
    expect(field._metadata.scale).toBe(2);
  });

  test("decimal without scale has no scale in metadata", () => {
    const field = db.decimal();
    expect(field.type).toBe("decimal");
    expect(field._metadata.scale).toBeUndefined();
  });

  test("decimal scale validation rejects out-of-range values", () => {
    expect(() => db.decimal({ scale: -1 })).toThrow("scale must be an integer between 0 and 12");
    expect(() => db.decimal({ scale: 13 })).toThrow("scale must be an integer between 0 and 12");
  });

  test("decimal scale validation rejects non-integer values", () => {
    expect(() => db.decimal({ scale: 1.5 })).toThrow("scale must be an integer between 0 and 12");
  });

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
  ])("decimal parse validates valid decimal string %s", (value) => {
    const field = db.decimal();
    const invoker: TailorPrincipal = {
      id: "test",
      type: "user",
      workspaceId: "workspace-test",
      attributes: {},
      attributeList: [],
    };
    expect(field.parse({ value, data: {}, invoker })).toEqual({ value });
  });

  test.each(["abc", 123, "", "1_000_000", "0b1.1p-5", "1e", "e5", "."])(
    "decimal parse rejects invalid decimal string %s",
    (value) => {
      const field = db.decimal();
      const invoker: TailorPrincipal = {
        id: "test",
        type: "user",
        workspaceId: "workspace-test",
        attributes: {},
        attributeList: [],
      };
      expect(field.parse({ value, data: {}, invoker })).toHaveProperty("issues");
    },
  );
});
