// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test, expectTypeOf } from "vitest";
import { t } from "./type";
import type { TypeLevelError } from "#/types/helpers";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
type TypeEquals<T, Message extends string> = Equal<T, TypeLevelError<Message>>;

describe("typeName method type safety", () => {
  test("invalid field modifiers expose type-level error messages", () => {
    const described = t.string().description("Name");
    type _Description = Expect<
      TypeEquals<typeof described.description, ".description() has already been set">
    >;

    const scalar = t.string();
    type _TypeNameScalar = Expect<
      TypeEquals<typeof scalar.typeName, "typeName can only be set on enum or object fields">
    >;

    const named = t.enum(["active", "inactive"]).typeName("Status");
    type _TypeNameDuplicate = Expect<
      TypeEquals<typeof named.typeName, ".typeName() has already been set">
    >;

    const validated = t.string().validate(() => undefined);
    type _ValidateDuplicate = Expect<
      TypeEquals<typeof validated.validate, ".validate() has already been set">
    >;
  });

  test("should allow typeName on enum types", () => {
    const enumField = t.enum(["active", "inactive"]);
    const withTypeName = enumField.typeName("CustomEnum");

    expectTypeOf(withTypeName).not.toBeNever();
  });

  test("should allow typeName on nested object types", () => {
    const objectField = t.object({
      count: t.int(),
    });
    const withTypeName = objectField.typeName("CustomObject");

    expectTypeOf(withTypeName).not.toBeNever();
  });

  test("should NOT allow typeName on string type", () => {
    const stringField = t.string();
    // @ts-expect-error - typeName should not be callable on scalar types
    stringField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on int type", () => {
    const intField = t.int();
    // @ts-expect-error - typeName should not be callable on scalar types
    intField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on uuid type", () => {
    const uuidField = t.uuid();
    // @ts-expect-error - typeName should not be callable on scalar types
    uuidField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on boolean type", () => {
    const boolField = t.bool();
    // @ts-expect-error - typeName should not be callable on scalar types
    boolField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on float type", () => {
    const floatField = t.float();
    // @ts-expect-error - typeName should not be callable on scalar types
    floatField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on date type", () => {
    const dateField = t.date();
    // @ts-expect-error - typeName should not be callable on scalar types
    dateField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on datetime type", () => {
    const datetimeField = t.datetime();
    // @ts-expect-error - typeName should not be callable on scalar types
    datetimeField.typeName("InvalidTypeName");
  });

  test("should NOT allow typeName on time type", () => {
    const timeField = t.time();
    // @ts-expect-error - typeName should not be callable on scalar types
    timeField.typeName("InvalidTypeName");
  });

  test("should allow chaining description and typeName on enum", () => {
    const enumField = t
      .enum(["active", "inactive"])
      .description("Status enum")
      .typeName("StatusEnum");

    expectTypeOf(enumField).not.toBeNever();
  });

  test("should allow chaining description and typeName on object", () => {
    const objectField = t
      .object({
        count: t.int(),
      })
      .description("Metadata object")
      .typeName("MetadataObject");

    expectTypeOf(objectField).not.toBeNever();
  });

  test("should NOT allow calling typeName twice", () => {
    const enumField = t.enum(["active", "inactive"]).typeName("FirstName");
    // @ts-expect-error - typeName should not be callable twice
    enumField.typeName("SecondName");
  });
});
