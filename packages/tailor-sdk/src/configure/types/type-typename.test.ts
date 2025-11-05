import { describe, it, expectTypeOf } from "vitest";
import { t } from "./type";

describe("typeName method type safety", () => {
  it("should allow typeName on enum types", () => {
    const enumField = t.enum("active", "inactive");
    const withTypeName = enumField.typeName("CustomEnum");

    expectTypeOf(withTypeName).not.toBeNever();
  });

  it("should allow typeName on nested object types", () => {
    const objectField = t.object({
      count: t.int(),
    });
    const withTypeName = objectField.typeName("CustomObject");

    expectTypeOf(withTypeName).not.toBeNever();
  });

  it("should NOT allow typeName on string type", () => {
    const stringField = t.string();
    // @ts-expect-error - typeName should not be callable on scalar types
    stringField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on int type", () => {
    const intField = t.int();
    // @ts-expect-error - typeName should not be callable on scalar types
    intField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on uuid type", () => {
    const uuidField = t.uuid();
    // @ts-expect-error - typeName should not be callable on scalar types
    uuidField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on boolean type", () => {
    const boolField = t.bool();
    // @ts-expect-error - typeName should not be callable on scalar types
    boolField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on float type", () => {
    const floatField = t.float();
    // @ts-expect-error - typeName should not be callable on scalar types
    floatField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on date type", () => {
    const dateField = t.date();
    // @ts-expect-error - typeName should not be callable on scalar types
    dateField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on datetime type", () => {
    const datetimeField = t.datetime();
    // @ts-expect-error - typeName should not be callable on scalar types
    datetimeField.typeName("InvalidTypeName");
  });

  it("should NOT allow typeName on time type", () => {
    const timeField = t.time();
    // @ts-expect-error - typeName should not be callable on scalar types
    timeField.typeName("InvalidTypeName");
  });

  it("should allow chaining description and typeName on enum", () => {
    const enumField = t
      .enum("active", "inactive")
      .description("Status enum")
      .typeName("StatusEnum");

    expectTypeOf(enumField).not.toBeNever();
  });

  it("should allow chaining description and typeName on object", () => {
    const objectField = t
      .object({
        count: t.int(),
      })
      .description("Metadata object")
      .typeName("MetadataObject");

    expectTypeOf(objectField).not.toBeNever();
  });

  it("should NOT allow calling typeName twice", () => {
    const enumField = t.enum("active", "inactive").typeName("FirstName");
    // @ts-expect-error - typeName should not be callable twice
    enumField.typeName("SecondName");
  });
});
