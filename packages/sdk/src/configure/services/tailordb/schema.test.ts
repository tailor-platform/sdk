// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expectTypeOf, expect, test } from "vitest";
import { t } from "#/configure/types/index";
import { db, type TailorAnyDBField } from "./schema";
import type { FieldValidateInput, ValidateConfig } from "#/configure/types/field.types";
import type { TailorPrincipal } from "#/runtime/types";
import type { output, TypeLevelError } from "#/types/helpers";
import type { Hook } from "./types";

type DateString = `${number}-${number}-${number}`;
type TimeString = `${number}:${number}`;
type TimeZoneOffsetString = "Z" | "z" | `${"+" | "-"}${TimeString}`;
type DateTimeString =
  `${DateString}${"T" | "t"}${TimeString}:${number}${"" | `.${number}`}${TimeZoneOffsetString}`;
type UUIDString = `${string}-${string}-${string}-${string}-${string}`;
type DecimalString = `${number}`;

describe("TailorDBField basic field type tests", () => {
  test("string field outputs string type correctly", () => {
    const _stringType = db.type("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      id: UUIDString;
      name: string;
    }>();
  });

  test("int field outputs number type correctly", () => {
    const _intType = db.type("Test", {
      age: db.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      id: UUIDString;
      age: number;
    }>();
  });

  test("bool field outputs boolean type correctly", () => {
    const _boolType = db.type("Test", {
      active: db.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      id: UUIDString;
      active: boolean;
    }>();
  });

  test("float field outputs number type correctly", () => {
    const _floatType = db.type("Test", {
      price: db.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      id: UUIDString;
      price: number;
    }>();
  });

  test("uuid field outputs UUID string type correctly", () => {
    const _uuidType = db.type("Test", {
      uuid: db.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: UUIDString;
      uuid: UUIDString;
    }>();
  });

  test("date field outputs date string type correctly", () => {
    const _dateType = db.type("Test", {
      birthDate: db.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      id: UUIDString;
      birthDate: DateString;
    }>();
  });

  test("datetime field outputs datetime string | Date type correctly", () => {
    const _datetimeType = db.type("Test", {
      timestamp: db.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toMatchObjectType<{
      id: UUIDString;
      timestamp: DateTimeString | Date;
    }>();
  });

  test("time field outputs time string type correctly", () => {
    const _timeType = db.type("Test", {
      openingTime: db.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      id: UUIDString;
      openingTime: TimeString;
    }>();
  });

  test("pickFields preserves the generated id UUID type", () => {
    const _schemaType = t.object({
      ...db
        .type("Test", {
          name: db.string(),
        })
        .pickFields(["id"], { optional: true }),
    });

    expectTypeOf<output<typeof _schemaType>>().toEqualTypeOf<{
      id?: UUIDString | null;
    }>();
  });

  test("pickFields recomputes output from the base field type", () => {
    const _schemaType = t.object({
      ...db
        .type("Test", {
          names: db.string({ array: true }),
          nickname: db.string({ optional: true }),
        })
        .pickFields(["id", "names", "nickname"], { array: false, optional: false }),
    });

    expectTypeOf<output<typeof _schemaType>>().toEqualTypeOf<{
      id: UUIDString;
      names: string;
      nickname: string;
    }>();
  });

  test("pickFields recomputes enum and nested object output from the base field type", () => {
    const _schemaType = t.object({
      ...db
        .type("Test", {
          status: db.enum(["active", "inactive"], { array: true }),
          profile: db.object({ name: db.string() }, { array: true }),
        })
        .pickFields(["status", "profile"], { array: false }),
    });

    expectTypeOf<output<typeof _schemaType>>().toEqualTypeOf<{
      status: "active" | "inactive";
      profile: { name: string };
    }>();
  });

  test("pickFields preserves existing options that are not overridden", () => {
    const _schemaType = t.object({
      ...db
        .type("Test", {
          names: db.string({ array: true }),
          nickname: db.string({ optional: true }),
        })
        .pickFields(["names", "nickname"], { array: true }),
    });

    expectTypeOf<output<typeof _schemaType>>().toEqualTypeOf<{
      names: string[];
      nickname?: string[] | null;
    }>();
  });
});

describe("TailorDBField optional option tests", () => {
  test("optional option generates nullable type", () => {
    const _optionalType = db.type("Test", {
      description: db.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      id: UUIDString;
      description?: string | null;
    }>();
  });

  test("multiple optional fields work correctly", () => {
    const _multiOptionalType = db.type("Test", {
      title: db.string(),
      description: db.string({ optional: true }),
      count: db.int({ optional: true }),
    });
    expectTypeOf<output<typeof _multiOptionalType>>().toEqualTypeOf<{
      id: UUIDString;
      title: string;
      description?: string | null;
      count?: number | null;
    }>();
  });
});

describe("TailorDBField array option tests", () => {
  test("array option generates array type", () => {
    const _arrayType = db.type("Test", {
      tags: db.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      id: UUIDString;
      tags: string[];
    }>();
  });

  test("optional array works correctly", () => {
    const _optionalArrayType = db.type("Test", {
      items: db.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      id: UUIDString;
      items?: string[] | null;
    }>();
  });

  test("multiple array fields work correctly", () => {
    const _multiArrayType = db.type("Test", {
      tags: db.string({ array: true }),
      numbers: db.int({ array: true }),
      flags: db.bool({ array: true }),
    });
    expectTypeOf<output<typeof _multiArrayType>>().toEqualTypeOf<{
      id: UUIDString;
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
    const _optionalEnumType = db.type("Test", {
      priority: db.enum(["high", "medium", "low"], { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      id: UUIDString;
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
    const _enumArrayType = db.type("Test", {
      categories: db.enum(["a", "b", "c"], { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      id: UUIDString;
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorDBField RelationConfig option field tests", () => {
  const User = db.type("User", {
    name: db.string(),
    email: db.string(),
  });

  const Customer = db.type("Customer", {
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
    const _indexType = db.type("Test", {
      email: db.string().index(),
    });
    expectTypeOf<output<typeof _indexType>>().toEqualTypeOf<{
      id: UUIDString;
      email: string;
    }>();
  });

  test("unique() modifier does not affect type", () => {
    const _uniqueType = db.type("Test", {
      username: db.string().unique(),
    });
    expectTypeOf<output<typeof _uniqueType>>().toEqualTypeOf<{
      id: UUIDString;
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

    const _userType = db.type("User", {
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
});

describe("TailorDBField relation modifier tests", () => {
  test("relation does not create reference type", () => {
    const _userType = db.type("User", {
      name: db.string(),
    });
    const _postType = db.type("Post", {
      title: db.string(),
      authorId: db.uuid().relation({
        type: "oneToOne",
        toward: { type: _userType, as: "author" },
        backward: "author",
      }),
    });
    expectTypeOf<output<typeof _postType>>().toEqualTypeOf<{
      id: UUIDString;
      title: string;
      authorId: UUIDString;
    }>();
  });

  test("attempting to set relation twice causes type error", () => {
    const _userType = db.type("User", {
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
    const _hookType = db.type("Test", {
      name: db.string().hooks({
        create: () => "created",
        update: () => "updated",
      }),
    });
    expectTypeOf<output<typeof _hookType>>().toEqualTypeOf<{
      id: UUIDString;
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
    const _validateType = db.type("Test", {
      email: db.string().validate(() => true),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: UUIDString;
      email: string;
    }>();
  });

  test("validate modifier can receive object with message", () => {
    const _validateType = db.type("Test", {
      email: db.string().validate([({ value }) => value.includes("@"), "Email must contain @"]),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: UUIDString;
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
    const _validateType = db.type("Test", {
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
    const _timestampType = db.type("TestWithTimestamp", {
      name: db.string(),
      ...db.fields.timestamps(),
    });
    expectTypeOf<output<typeof _timestampType>>().toEqualTypeOf<{
      id: UUIDString;
      name: string;
      createdAt: DateTimeString | Date;
      updatedAt: DateTimeString | Date;
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
    const _complexType = db.type("User", {
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
      id: UUIDString;
      name: string;
      email: string;
      age?: number | null;
      isActive: boolean;
      tags: string[];
      role: "admin" | "user" | "guest";
      score: number;
      birthDate: DateString;
      lastLogin?: DateTimeString | Date | null;
      closingTime: TimeString;
    }>();
  });
});

describe("TailorDBType edge case tests", () => {
  test("type with single field works correctly", () => {
    const _singleFieldType = db.type("Simple", {
      value: db.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      id: UUIDString;
      value: string;
    }>();
  });

  test("type with all optional fields works correctly", () => {
    const _allOptionalType = db.type("Optional", {
      a: db.string({ optional: true }),
      b: db.int({ optional: true }),
      c: db.bool({ optional: true }),
    });
    expectTypeOf<output<typeof _allOptionalType>>().toEqualTypeOf<{
      id: UUIDString;
      a?: string | null;
      b?: number | null;
      c?: boolean | null;
    }>();
  });

  test("type with all array fields works correctly", () => {
    const _allArrayType = db.type("Array", {
      strings: db.string({ array: true }),
      numbers: db.int({ array: true }),
      booleans: db.bool({ array: true }),
    });
    expectTypeOf<output<typeof _allArrayType>>().toEqualTypeOf<{
      id: UUIDString;
      strings: string[];
      numbers: number[];
      booleans: boolean[];
    }>();
  });
});

describe("TailorDBType type consistency tests", () => {
  test("same definition generates same type", () => {
    const _type1 = db.type("Same", {
      name: db.string(),
      age: db.int(),
    });
    const _type2 = db.type("Same", {
      name: db.string(),
      age: db.int(),
    });
    expectTypeOf<output<typeof _type1>>().toEqualTypeOf<output<typeof _type2>>();
  });

  test("id field is automatically added", () => {
    const _typeWithoutId = db.type("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _typeWithoutId>>().toEqualTypeOf<{
      id: UUIDString;
      name: string;
    }>();
  });
});

describe("TailorDBType self relation tests", () => {
  test("when toward.type is self, rawRelation stores the config (processing happens in parser layer)", () => {
    const TestType = db.type("TestType", {
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
    const A = db.type("Node", {
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
    const _userType = db.type("User", {
      name: db.string(),
    });

    expect(_userType.metadata.settings?.pluralForm).toBeUndefined();
  });

  test("when specifying name and plural form as tuple, pluralForm is set", () => {
    const _personType = db.type(["Person", "People"], {
      name: db.string(),
    });

    expect(_personType.metadata.settings?.pluralForm).toBe("People");
  });

  test("when plural form is explicitly specified, default pluralization is not used", () => {
    const _childType = db.type(["Child", "Children"], {
      name: db.string(),
      age: db.int(),
    });

    expect(_childType.metadata.settings?.pluralForm).toBe("Children");
  });

  test("when plural form is empty string, it is not set in configure (inflection is executed at parser layer)", () => {
    const _dataType = db.type(["Datum", ""], {
      value: db.string(),
    });

    expect(_dataType.metadata.settings?.pluralForm).toBeUndefined();
  });

  test("error when plural form is same as name (when explicitly specified in tuple format)", () => {
    expect(() => db.type(["Data", "Data"], {})).toThrowError(
      "The name and the plural form must be different. name=Data",
    );
  });

  test("all existing features work correctly with tuple format", () => {
    const _postType = db.type(["Post", "Posts"], {
      title: db.string(),
      content: db.string({ optional: true }),
      ...db.fields.timestamps(),
    });

    expectTypeOf<output<typeof _postType>>().toEqualTypeOf<{
      id: UUIDString;
      title: string;
      content?: string | null;
      createdAt: DateTimeString | Date;
      updatedAt: DateTimeString | Date;
    }>();

    expect(_postType.name).toBe("Post");
    expect(_postType.metadata.settings?.pluralForm).toBe("Posts");
  });

  test("plural form with special characters can also be set", () => {
    const _deviceType = db.type(["Device", "Device's"], {
      name: db.string(),
      status: db.enum(["active", "inactive"]),
    });

    expect(_deviceType.metadata.settings?.pluralForm).toBe("Device's");
  });

  test("plural form with numbers can also be set", () => {
    const _itemType = db.type(["Item", "100Items"], {
      name: db.string(),
      quantity: db.int(),
    });

    expect(_itemType.metadata.settings?.pluralForm).toBe("100Items");
  });

  test("validation and plural form coexist in tuple format", () => {
    const _userType = db
      .type(["User", "Users"], {
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
    const _categoryType = db.type(["Category", "Categories"], {
      name: db.string(),
    });

    const _productType = db.type(["Product", "Products"], {
      name: db.string(),
      categoryId: db.uuid().relation({
        type: "oneToOne",
        toward: { type: _categoryType },
      }),
    });

    expect(_categoryType.metadata.settings?.pluralForm).toBe("Categories");
    expect(_productType.metadata.settings?.pluralForm).toBe("Products");
  });

  test("plural form with mixed case can also be set", () => {
    const _dataType = db.type(["Data", "DataSet"], {
      value: db.string(),
    });

    expect(_dataType.metadata.settings?.pluralForm).toBe("DataSet");
  });
});

describe("TailorDBType hooks modifier tests", () => {
  test("hooks modifier does not affect output type", () => {
    const _hookType = db
      .type("Test", {
        name: db.string(),
      })
      .hooks({
        name: {
          create: () => "created",
          update: () => "updated",
        },
      });
    expectTypeOf<output<typeof _hookType>>().toEqualTypeOf<{
      id: UUIDString;
      name: string;
    }>();
  });

  test("setting hooks on id causes type error", () => {
    db.type("Test", {
      name: db.string(),
    }).hooks({
      // @ts-expect-error hooks() cannot be called on the "id" field
      id: {
        create: () => "created",
      },
    });
  });

  test("setting hooks on nested field causes type error", () => {
    db.type("Test", {
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
    const testType = db.type("Test", { name: db.string() });
    const _hooks = testType.hooks;
    type ExpectedHooksParam = Parameters<typeof _hooks>[0];
    type ActualNameType = Exclude<ExpectedHooksParam["name"], undefined>;

    expectTypeOf<ActualNameType>().toEqualTypeOf<
      Hook<
        {
          id: UUIDString;
          readonly name: string;
        },
        string
      >
    >();
  });

  test("hooks modifier on optional field receives null", () => {
    const testType = db.type("Test", {
      name: db.string({ optional: true }),
    });
    const _hooks = testType.hooks;
    type ExpectedHooksParam = Parameters<typeof _hooks>[0];
    type ActualNameType = Exclude<ExpectedHooksParam["name"], undefined>;

    expectTypeOf<ActualNameType>().toEqualTypeOf<
      Hook<
        {
          id: UUIDString;
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
      .type("Test", {
        email: db.string(),
      })
      .validate({
        email: () => true,
      });

    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: UUIDString;
      email: string;
    }>();
    const fieldMetadata = _validateType.fields.email.metadata;
    expect(fieldMetadata.validate).toHaveLength(1);
  });

  test("validate modifier can receive object with message", () => {
    const _validateType = db
      .type("Test", {
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
      .type("Test", {
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
    db.type("Test", {
      name: db.string().validate(() => true),
      // @ts-expect-error validate() cannot be called after validate() has already been called
    }).validate({
      name: () => true,
    });
  });

  test("setting validate on id causes type error", () => {
    db.type("Test", {
      name: db.string(),
    }).validate({
      // @ts-expect-error validate() cannot be called on the "id" field
      id: () => true,
    });
  });

  test("validate modifier on string field receives string", () => {
    const _validate = db.type("Test", { name: db.string() }).validate;
    expectTypeOf<ValidateConfig<string, { id: UUIDString; name: string }>>().toExtend<
      Parameters<typeof _validate>[0]["name"]
    >();
  });

  test("validate modifier on optional field receives null", () => {
    const _validate = db.type("Test", {
      name: db.string({ optional: true }),
    }).validate;
    expectTypeOf<
      ValidateConfig<string | null, { id: UUIDString; name?: string | null }>
    >().toExtend<Parameters<typeof _validate>[0]["name"]>();
  });
});

describe("db.object tests", () => {
  test("correctly infers basic object type", () => {
    const _objectType = db.type("Test", {
      user: db.object({
        name: db.string(),
        age: db.int(),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
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
    const _objectType = db.type("Test", {
      user: db.object({
        name: db.string(),
        age: db.int({ optional: true }),
        email: db.string({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
      user: {
        name: string;
        age?: number | null;
        email?: string | null;
      };
    }>();
  });

  test("correctly infers object type with optional option", () => {
    const _objectType = db.type("Test", {
      user: db.object(
        {
          name: db.string(),
          avatar: db.string({ optional: true }),
        },
        { optional: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
      user?: {
        name: string;
        avatar?: string | null;
      } | null;
    }>();
  });

  test("correctly infers object type with array option", () => {
    const _objectType = db.type("Test", {
      users: db.object(
        {
          name: db.string(),
          age: db.int(),
        },
        { array: true },
      ),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
      users: {
        name: string;
        age: number;
      }[];
    }>();
  });

  test("correctly infers object type with array fields", () => {
    const _objectType = db.type("Test", {
      user: db.object({
        name: db.string(),
        tags: db.string({ array: true }),
        scores: db.int({ array: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
      user: {
        name: string;
        tags: string[];
        scores: number[];
      };
    }>();
  });

  test("correctly infers object type with multiple modifiers", () => {
    const _objectType = db.type("Test", {
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
      id: UUIDString;
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
    const _objectType = db.type("Test", {
      settings: db.object({
        enabled: db.bool(),
        push: db.bool({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
      settings: {
        enabled: boolean;
        push?: boolean | null;
      };
    }>();
  });

  test("correctly infers object type with float and enum types", () => {
    const _objectType = db.type("Test", {
      product: db.object({
        name: db.string(),
        price: db.float(),
        category: db.enum(["electronics", "books", "clothing"]),
        weight: db.float({ optional: true }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: UUIDString;
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
    const userType = db.type("User", {
      name: db.string().description("User name"),
      age: db.int().description("User age"),
    });

    expect(userType.fields.name.metadata.description).toBe("User name");
    expect(userType.fields.age.metadata.description).toBe("User age");
  });

  test("TailorDBType description is set via second argument", () => {
    const userType = db.type("User", "User profile type", {
      name: db.string(),
    });

    expect(userType._description).toBe("User profile type");
  });

  test("TailorDBField nested object supports description", () => {
    const profileType = db.type("Profile", {
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
    const userType = db.type("User", "User type for resolver", {
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
    const User = db.type("User", { name: db.string() });
    const _field = db
      .uuid()
      .description("User reference")
      .relation({ type: "n-1", toward: { type: User } });
    expectTypeOf<output<typeof _field>>().toEqualTypeOf<UUIDString>();
  });
});

describe("TailorDBType files method tests", () => {
  test("files method adds file fields to metadata", () => {
    const userType = db
      .type("User", {
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
    const _userType = db.type("User", {
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
    const _userType = db.type("User", {
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
    id: "123e4567-e89b-12d3-a456-426614174000",
    type: "user",
    workspaceId: "workspace-test",
    attributes: {},
    attributeList: [],
  };
  const data = {};

  test("validates string field values", () => {
    const field = db.string();
    const result = field.parse({ value: "hello", data, invoker });
    expect(result.issues).toBeUndefined();
    if (result.issues) {
      throw new Error("Unexpected issues");
    }
    expect(result.value).toBe("hello");

    const bad = field.parse({ value: 123, data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a string: received 123");
  });

  test("validates enum values", () => {
    const field = db.enum(["active", "inactive"]);
    const result = field.parse({ value: "active", data, invoker });
    expect(result.issues).toBeUndefined();
    if (result.issues) {
      throw new Error("Unexpected issues");
    }
    expect(result.value).toBe("active");

    const bad = field.parse({ value: "unknown", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Must be one of [active, inactive]: received unknown");
  });

  test("validates integer values", () => {
    const field = db.int();
    const ok = field.parse({ value: 42, data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toBe(42);

    const bad = field.parse({ value: "not-a-number", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected an integer: received not-a-number");
  });

  test("validates float values", () => {
    const field = db.float();
    const ok = field.parse({ value: 3.14, data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toBe(3.14);

    const bad = field.parse({ value: "not-a-number", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a number: received not-a-number");
  });

  test("validates boolean values", () => {
    const field = db.bool();
    const ok = field.parse({ value: true, data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toBe(true);

    const bad = field.parse({ value: "true", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a boolean: received true");
  });

  test("validates nested object values", () => {
    const field = db.object({
      name: db.string(),
      age: db.int({ optional: true }),
    });
    const ok = field.parse({ value: { name: "test", age: 30 }, data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toEqual({ name: "test", age: 30 });

    const bad = field.parse({ value: { name: 123 }, data, invoker });
    expect(bad.issues?.[0]?.path).toEqual(["name"]);
    expect(bad.issues?.[0]?.message).toBe("Expected a string: received 123");
  });

  test("validates array values", () => {
    const field = db.int({ array: true });
    const ok = field.parse({ value: [1, 2, 3], data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toEqual([1, 2, 3]);
  });

  test("validates UUID format", () => {
    const field = db.uuid();
    const ok = field.parse({ value: "123e4567-e89b-12d3-a456-426614174000", data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toBe("123e4567-e89b-12d3-a456-426614174000");

    const bad = field.parse({ value: "not-a-uuid", data, invoker });
    expect(bad.issues?.[0]?.message).toBe("Expected a valid UUID: received not-a-uuid");
  });

  test("validates date format", () => {
    const field = db.date();
    const ok = field.parse({ value: "2025-01-01", data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toBe("2025-01-01");

    const bad = field.parse({ value: "2025/01/01", data, invoker });
    expect(bad.issues?.[0]?.message).toBe(
      'Expected to match "yyyy-MM-dd" format: received 2025/01/01',
    );

    const calendarDateShape = field.parse({ value: "2025-02-30", data, invoker });
    expect(calendarDateShape.issues).toBeUndefined();
    if (calendarDateShape.issues) {
      throw new Error("Unexpected issues");
    }
    expect(calendarDateShape.value).toBe("2025-02-30");
  });

  test("validates datetime format", () => {
    const field = db.datetime();
    for (const value of [
      "2025-01-01T10:11:12Z",
      "2025-01-01T10:11:12.123456Z",
      "2025-01-01T10:11:12+09:00",
      "2025-01-01t10:11:12-08:00",
      "2025-02-30T10:11:12Z",
    ]) {
      const ok = field.parse({ value, data, invoker });
      expect(ok.issues).toBeUndefined();
      if (ok.issues) {
        throw new Error("Unexpected issues");
      }
      expect(ok.value).toBe(value);
    }

    const bad = field.parse({
      value: "2025-01-01T10:11:12+0900",
      data,
      invoker,
    });
    expect(bad.issues?.[0]?.message).toBe(
      "Expected to match ISO format: received 2025-01-01T10:11:12+0900",
    );

    const invalidTime = field.parse({
      value: "2025-01-01T25:11:12Z",
      data,
      invoker,
    });
    expect(invalidTime.issues?.[0]?.message).toBe(
      "Expected to match ISO format: received 2025-01-01T25:11:12Z",
    );

    const invalidOffset = field.parse({
      value: "2025-01-01T10:11:12+24:00",
      data,
      invoker,
    });
    expect(invalidOffset.issues?.[0]?.message).toBe(
      "Expected to match ISO format: received 2025-01-01T10:11:12+24:00",
    );
  });

  test("validates time format", () => {
    const field = db.time();
    const ok = field.parse({ value: "10:11", data, invoker });
    expect(ok.issues).toBeUndefined();
    if (ok.issues) {
      throw new Error("Unexpected issues");
    }
    expect(ok.value).toBe("10:11");

    const bad = field.parse({ value: "10:11:12", data, invoker });
    expect(bad.issues?.[0]?.message).toBe('Expected to match "HH:mm" format: received 10:11:12');
  });

  test("validates required and optional handling", () => {
    const requiredField = db.string();
    const requiredMissing = requiredField.parse({ value: undefined, data, invoker });
    expect(requiredMissing.issues?.[0]?.message).toBe("Required field is missing");

    const optionalField = db.string({ optional: true });
    const optionalNull = optionalField.parse({ value: undefined, data, invoker });
    expect(optionalNull.issues).toBeUndefined();
    if (optionalNull.issues) {
      throw new Error("Unexpected issues");
    }
    expect(optionalNull.value).toBeNull();
  });
});

describe("TailorDBType gqlOperations tests", () => {
  test("gqlOperations stores raw config via features()", () => {
    const orderType = db
      .type("Order", {
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
      .type("Archive", {
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
      .type("Secret", {
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
      .type("Log", {
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
      .type("ReadOnly", {
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
      .type("Audit", {
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
    const User = db.type("User", { name: db.string() });
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

    const typeA = db.type("TypeA", { name: sharedField }).hooks({ name: { create: () => "A" } });
    const typeB = db.type("TypeB", { name: sharedField });

    expect(typeA.fields.name.metadata.hooks).toBeDefined();
    expect(typeB.fields.name.metadata.hooks).toBeUndefined();
    expect(sharedField.metadata.hooks).toBeUndefined();
  });

  test("type.validate() does not mutate the shared field", () => {
    const sharedField = db.string();

    const typeA = db
      .type("TypeA", { email: sharedField })
      .validate({ email: ({ value }) => value.includes("@") });
    const typeB = db.type("TypeB", { email: sharedField });

    expect(typeA.fields.email.metadata.validate).toBeDefined();
    expect(typeB.fields.email.metadata.validate).toBeUndefined();
    expect(sharedField.metadata.validate).toBeUndefined();
  });

  test("hooks() does not replace entries in the original fields record", () => {
    const nameField = db.string();
    const fields = { name: nameField };

    db.type("TypeA", fields).hooks({ name: { create: () => "hooked" } });

    // The fields record should still reference the original field instance
    expect(fields.name).toBe(nameField);
  });

  test("validate() does not replace entries in the original fields record", () => {
    const emailField = db.string();
    const fields = { email: emailField };

    db.type("TypeA", fields).validate({ email: ({ value }) => value.includes("@") });

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

  test("clone with both optional and array overrides", () => {
    const original = db.string();
    const cloned = original.clone({ optional: true, array: true });

    expect(cloned.metadata.required).toBe(false);
    expect(cloned.metadata.array).toBe(true);
    expectTypeOf<output<typeof cloned>>().toEqualTypeOf<string[] | null>();
  });

  test("clones unique modifier correctly", () => {
    const original = db.string().unique();
    const cloned = original.clone();

    expect(cloned.metadata.unique).toBe(true);
    expect(cloned.metadata.index).toBe(true);
  });

  test("clones relation config correctly", () => {
    const User = db.type("User", { name: db.string() });
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

  test("clone recomputes output from the base field type", () => {
    const clonedArray = db.string({ array: true }).clone({ array: true });
    const clonedScalar = db.string({ array: true }).clone({ array: false });
    const clonedRequired = db.string({ optional: true }).clone({ optional: false });
    const clonedUnchanged = db.string({ optional: true, array: true }).clone();
    const clonedOptionalArray = db.string({ optional: true }).clone({ array: true });
    const clonedRequiredArray = db
      .string({ optional: true, array: true })
      .clone({ optional: false });
    const clonedEnumArray = db.enum(["active", "inactive"], { array: true }).clone();
    const clonedEnumScalar = db.enum(["active", "inactive"], { array: true }).clone({
      array: false,
    });
    const clonedObjectArray = db.object({ name: db.string() }, { array: true }).clone();
    const clonedObjectScalar = db.object({ name: db.string() }, { array: true }).clone({
      array: false,
    });

    expectTypeOf<output<typeof clonedArray>>().not.toBeAny();
    expectTypeOf<output<typeof clonedScalar>>().not.toBeAny();
    expectTypeOf<output<typeof clonedRequired>>().not.toBeAny();
    expectTypeOf<output<typeof clonedUnchanged>>().not.toBeAny();
    expectTypeOf<output<typeof clonedOptionalArray>>().not.toBeAny();
    expectTypeOf<output<typeof clonedRequiredArray>>().not.toBeAny();
    expectTypeOf<output<typeof clonedEnumArray>>().not.toBeAny();
    expectTypeOf<output<typeof clonedEnumScalar>>().not.toBeAny();
    expectTypeOf<output<typeof clonedObjectArray>>().not.toBeAny();
    expectTypeOf<output<typeof clonedObjectScalar>>().not.toBeAny();
    expectTypeOf<output<typeof clonedArray>>().toEqualTypeOf<string[]>();
    expectTypeOf<output<typeof clonedScalar>>().toEqualTypeOf<string>();
    expectTypeOf<output<typeof clonedRequired>>().toEqualTypeOf<string>();
    expectTypeOf<output<typeof clonedUnchanged>>().toEqualTypeOf<string[] | null>();
    expectTypeOf<output<typeof clonedOptionalArray>>().toEqualTypeOf<string[] | null>();
    expectTypeOf<output<typeof clonedRequiredArray>>().toEqualTypeOf<string[]>();
    expectTypeOf<output<typeof clonedEnumArray>>().toEqualTypeOf<("active" | "inactive")[]>();
    expectTypeOf<output<typeof clonedEnumScalar>>().toEqualTypeOf<"active" | "inactive">();
    expectTypeOf<output<typeof clonedObjectArray>>().toEqualTypeOf<{ name: string }[]>();
    expectTypeOf<output<typeof clonedObjectScalar>>().toEqualTypeOf<{ name: string }>();

    const _indexed = clonedScalar.index();
  });

  test("clone preserves array guards for dynamic array overrides", () => {
    const maybeArray = true as boolean;
    const clonedExistingArray = db.string({ array: true }).clone({ array: maybeArray });
    const clonedExistingScalar = db.string().clone({ array: maybeArray });

    expectTypeOf<output<typeof clonedExistingArray>>().toEqualTypeOf<string[]>();
    expectTypeOf(clonedExistingArray.index).toEqualTypeOf<
      TypeLevelError<"index cannot be set on array fields">
    >();
    expectTypeOf(clonedExistingArray.unique).toEqualTypeOf<
      TypeLevelError<"unique cannot be set on array fields">
    >();
    expectTypeOf<output<typeof clonedExistingScalar>>().toEqualTypeOf<string>();
  });
});

describe("TailorDBField decimal type tests", () => {
  test("decimal field outputs decimal string type correctly", () => {
    const _decimalType = db.type("Test", {
      price: db.decimal(),
    });
    expectTypeOf<output<typeof _decimalType>>().toEqualTypeOf<{
      id: UUIDString;
      price: DecimalString;
    }>();
  });

  test("optional decimal field outputs decimal string | null type correctly", () => {
    const _decimalType = db.type("Test", {
      discount: db.decimal({ optional: true }),
    });
    expectTypeOf<output<typeof _decimalType>>().toEqualTypeOf<{
      id: UUIDString;
      discount?: DecimalString | null;
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

  test("decimal parse validates valid decimal strings", () => {
    const field = db.decimal();
    const invoker: TailorPrincipal = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      type: "user",
      workspaceId: "workspace-test",
      attributes: {},
      attributeList: [],
    };
    expect(field.parse({ value: "123.45", data: {}, invoker })).toEqual({ value: "123.45" });
    expect(field.parse({ value: "0", data: {}, invoker })).toEqual({ value: "0" });
    expect(field.parse({ value: "-99.99", data: {}, invoker })).toEqual({ value: "-99.99" });
    expect(field.parse({ value: "1000", data: {}, invoker })).toEqual({ value: "1000" });
    expect(field.parse({ value: ".5", data: {}, invoker })).toEqual({ value: ".5" });
    expect(field.parse({ value: "5.", data: {}, invoker })).toEqual({ value: "5." });
    expect(field.parse({ value: "4.321e+4", data: {}, invoker })).toEqual({ value: "4.321e+4" });
    expect(field.parse({ value: "1E-5", data: {}, invoker })).toEqual({ value: "1E-5" });
    expect(field.parse({ value: "2.41E-3", data: {}, invoker })).toEqual({ value: "2.41E-3" });
    expect(field.parse({ value: "-1.5e10", data: {}, invoker })).toEqual({ value: "-1.5e10" });
  });

  test("decimal parse rejects invalid decimal strings", () => {
    const field = db.decimal();
    const invoker: TailorPrincipal = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      type: "user",
      workspaceId: "workspace-test",
      attributes: {},
      attributeList: [],
    };
    const result1 = field.parse({ value: "abc", data: {}, invoker });
    expect(result1).toHaveProperty("issues");

    const result2 = field.parse({ value: 123, data: {}, invoker });
    expect(result2).toHaveProperty("issues");

    const result3 = field.parse({ value: "", data: {}, invoker });
    expect(result3).toHaveProperty("issues");

    const result4 = field.parse({ value: "1_000_000", data: {}, invoker });
    expect(result4).toHaveProperty("issues");

    const result5 = field.parse({ value: "0b1.1p-5", data: {}, invoker });
    expect(result5).toHaveProperty("issues");

    const result6 = field.parse({ value: "1e", data: {}, invoker });
    expect(result6).toHaveProperty("issues");

    const result7 = field.parse({ value: "e5", data: {}, invoker });
    expect(result7).toHaveProperty("issues");

    const result8 = field.parse({ value: ".", data: {}, invoker });
    expect(result8).toHaveProperty("issues");
  });
});
