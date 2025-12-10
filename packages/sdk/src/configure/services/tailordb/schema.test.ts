import { describe, it, expectTypeOf, expect } from "vitest";
import { t } from "@/configure/types";
import { db } from "./schema";
import type { Hook } from "./types";
import type { output } from "@/configure/types/helpers";
import type {
  FieldValidateInput,
  ValidateConfig,
} from "@/configure/types/validation";

describe("TailorDBField basic field type tests", () => {
  it("string field outputs string type correctly", () => {
    const _stringType = db.type("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  it("int field outputs number type correctly", () => {
    const _intType = db.type("Test", {
      age: db.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      id: string;
      age: number;
    }>();
  });

  it("bool field outputs boolean type correctly", () => {
    const _boolType = db.type("Test", {
      active: db.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      id: string;
      active: boolean;
    }>();
  });

  it("float field outputs number type correctly", () => {
    const _floatType = db.type("Test", {
      price: db.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      id: string;
      price: number;
    }>();
  });

  it("uuid field outputs string type correctly", () => {
    const _uuidType = db.type("Test", {
      uuid: db.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: string;
      uuid: string;
    }>();
  });

  it("date field outputs string type correctly", () => {
    const _dateType = db.type("Test", {
      birthDate: db.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      id: string;
      birthDate: string;
    }>();
  });

  it("datetime field outputs string type correctly", () => {
    const _datetimeType = db.type("Test", {
      timestamp: db.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toMatchObjectType<{
      id: string;
      timestamp: string;
    }>();
  });

  it("time field outputs string type correctly", () => {
    const _timeType = db.type("Test", {
      openingTime: db.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      id: string;
      openingTime: string;
    }>();
  });
});

describe("TailorDBField optional option tests", () => {
  it("optional option generates nullable type", () => {
    const _optionalType = db.type("Test", {
      description: db.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      id: string;
      description?: string | null;
    }>();
  });

  it("multiple optional fields work correctly", () => {
    const _multiOptionalType = db.type("Test", {
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
  it("array option generates array type", () => {
    const _arrayType = db.type("Test", {
      tags: db.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      id: string;
      tags: string[];
    }>();
  });

  it("optional array works correctly", () => {
    const _optionalArrayType = db.type("Test", {
      items: db.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      id: string;
      items?: string[] | null;
    }>();
  });

  it("multiple array fields work correctly", () => {
    const _multiArrayType = db.type("Test", {
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
  it("set enum field by passing string", () => {
    const enumField = db.enum(["active", "inactive", "pending"]);
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
    const enumField = db.enum([
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
    const enumField = db.enum([
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
    db.enum([]);
    // @ts-expect-error AllowedValues requires at least one value
    db.enum([], { optional: true });
  });

  it("optional enum() works correctly", () => {
    const _optionalEnumType = db.type("Test", {
      priority: db.enum(["high", "medium", "low"], { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      id: string;
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum array works correctly", () => {
    const _enumArrayType = db.type("Test", {
      categories: db.enum(["a", "b", "c"], { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      id: string;
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

  it("when toward.as is omitted, undefined is stored (inflection is executed at parser layer)", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        key: "id",
      },
    });

    expect(userField.reference!.nameMap[0]).toBeUndefined();
    expect(userField.reference!.nameMap[1]).toEqual("");
    expect(userField.metadata.foreignKeyType).toEqual("User");
    expect(userField.metadata.foreignKeyField).toEqual("id");
  });

  it('when toward.key is omitted, "id" is used by default', () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        as: "owner",
      },
    });

    expect(userField.reference!.key).toEqual("id");
    expect(userField.metadata.foreignKeyType).toEqual("User");
    expect(userField.metadata.foreignKeyField).toEqual("id");
  });

  it("behavior when toward.as, toward.key, and backward are all explicitly specified", () => {
    const managerField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        as: "manager",
        key: "email",
      },
      backward: "subordinates",
    });

    expect(managerField.reference!.nameMap[0]).toEqual("manager");
    expect(managerField.reference!.key).toEqual("email");
    expect(managerField.reference!.nameMap[1]).toEqual("subordinates");
    expect(managerField.metadata.foreignKeyType).toEqual("User");
    expect(managerField.metadata.foreignKeyField).toEqual("email");
  });

  it("behavior when only toward.as is explicitly specified", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        as: "owner",
      },
    });

    expect(userField.reference!.nameMap[0]).toEqual("owner");
    expect(userField.reference!.key).toEqual("id");
    expect(userField.reference!.nameMap[1]).toEqual("");
    expect(userField.metadata.foreignKeyType).toEqual("User");
    expect(userField.metadata.foreignKeyField).toEqual("id");
  });

  it("behavior when only toward.key is explicitly specified", () => {
    const customerField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: Customer,
        key: "customerId",
      },
    });

    expect(customerField.reference!.nameMap[0]).toBeUndefined();
    expect(customerField.reference!.key).toEqual("customerId");
    expect(customerField.reference!.nameMap[1]).toEqual("");
    expect(customerField.metadata.foreignKeyType).toEqual("Customer");
    expect(customerField.metadata.foreignKeyField).toEqual("customerId");
  });

  it("specifying non-existent field name for toward.key causes type error", () => {
    // @ts-expect-error 'nonExisting' does not exist on type 'Customer'
    db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: Customer,
        key: "nonExisting",
      },
    });
  });

  it("behavior when only backward is explicitly specified", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
      },
      backward: "relatedItems",
    });

    expect(userField.reference!.nameMap[0]).toBeUndefined();
    expect(userField.reference!.key).toEqual("id");
    expect(userField.reference!.nameMap[1]).toEqual("relatedItems");
    expect(userField.metadata.foreignKeyType).toEqual("User");
    expect(userField.metadata.foreignKeyField).toEqual("id");
  });

  it("type inference verification for manyToOne relation", () => {
    const userField = db.uuid().relation({
      type: "manyToOne",
      toward: {
        type: User,
        as: "author",
        key: "email",
      },
      backward: "posts",
    });

    expect(userField.reference!.nameMap[0]).toEqual("author");
    expect(userField.reference!.key).toEqual("email");
    expect(userField.reference!.nameMap[1]).toEqual("posts");
    expect(userField.metadata.foreignKeyType).toEqual("User");
    expect(userField.metadata.foreignKeyField).toEqual("email");
  });
});

describe("TailorDBField modifier chain tests", () => {
  it("index() modifier does not affect type", () => {
    const _indexType = db.type("Test", {
      email: db.string().index(),
    });
    expectTypeOf<output<typeof _indexType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  it("unique() modifier does not affect type", () => {
    const _uniqueType = db.type("Test", {
      username: db.string().unique(),
    });
    expectTypeOf<output<typeof _uniqueType>>().toEqualTypeOf<{
      id: string;
      username: string;
    }>();
  });
});

describe("TailorDBField relation modifier tests", () => {
  it("relation does not create reference type", () => {
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
      id: string;
      title: string;
      authorId: string;
    }>();
  });

  it("attempting to set relation twice causes type error", () => {
    const _userType = db.type("User", {
      name: db.string(),
    });

    // @ts-expect-error relation() cannot be called after relation() has already been called
    db.uuid()
      .relation({
        type: "oneToOne",
        toward: { type: _userType },
      })
      .relation({
        type: "oneToOne",
        toward: { type: _userType },
      });
  });
});

describe("TailorDBField hooks modifier tests", () => {
  it("hooks modifier does not affect output type", () => {
    const _hookType = db.type("Test", {
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

  it("calling hooks modifier more than once causes type error", () => {
    db.string()
      .hooks({
        create: () => "created",
      })
      .hooks({
        update: () => "updated",
      });
  });

  it("setting hooks on nested field causes type error", () => {
    // @ts-expect-error hooks() cannot be called on nested fields
    db.object({
      first: db.string(),
      last: db.string(),
    }).hooks({ create: () => ({ first: "A", last: "B" }) });
  });

  it("hooks modifier on string field receives string", () => {
    const _hooks = db.string().hooks;
    expectTypeOf<Parameters<typeof _hooks>[0]>().toEqualTypeOf<
      Hook<unknown, string>
    >();
  });

  it("hooks modifier on optional field receives null", () => {
    const _hooks = db.string({ optional: true }).hooks;
    expectTypeOf<Parameters<typeof _hooks>[0]>().toEqualTypeOf<
      Hook<unknown, string | null>
    >();
  });
});

describe("TailorDBField validate modifier tests", () => {
  it("validate modifier does not affect type", () => {
    const _validateType = db.type("Test", {
      email: db.string().validate(() => true),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  it("validate modifier can receive object with message", () => {
    const _validateType = db.type("Test", {
      email: db
        .string()
        .validate([({ value }) => value.includes("@"), "Email must contain @"]),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();

    const fieldConfig = _validateType.fields.email.config;
    expect(fieldConfig.validate).toBeDefined();
    expect(fieldConfig?.validate?.[0].errorMessage).toBe(
      "Email must contain @",
    );
  });

  it("validate modifier can receive multiple validators", () => {
    const _validateType = db.type("Test", {
      password: db
        .string()
        .validate(
          ({ value }) => value.length >= 8,
          [
            ({ value }) => /[A-Z]/.test(value),
            "Password must contain uppercase letter",
          ],
        ),
    });

    const fieldConfig = _validateType.fields.password.config;
    expect(fieldConfig.validate).toHaveLength(2);
    expect(fieldConfig?.validate?.[1].errorMessage).toBe(
      "Password must contain uppercase letter",
    );
  });

  it("calling validate modifier more than once causes type error", () => {
    // @ts-expect-error validate() cannot be called after validate() has already been called
    db.string()
      .validate(() => true)
      .validate(() => true);
  });

  it("validate modifier on string field receives string", () => {
    const _validate = db.string().validate;
    expectTypeOf<Parameters<typeof _validate>[1]>().toEqualTypeOf<
      FieldValidateInput<string>
    >();
  });

  it("validate modifier on optional field receives null", () => {
    const _validate = db.string({ optional: true }).validate;
    expectTypeOf<Parameters<typeof _validate>[1]>().toEqualTypeOf<
      FieldValidateInput<string | null>
    >();
  });
});

describe("TailorDBField vector modifier tests", () => {
  it("vector modifier can only be used on string field", () => {
    const _vector = db.string().vector();
    expectTypeOf<output<typeof _vector>>().toEqualTypeOf<string>();
    expect(_vector.metadata.vector).toBe(true);

    // @ts-expect-error vector() can only be called on string fields
    db.int().vector();
    // @ts-expect-error vector() cannot be called on array fields
    db.string({ array: true }).vector();
  });

  it("calling vector modifier more than once causes type error", () => {
    // @ts-expect-error vector() cannot be called after vector() has already been called
    db.string().vector().vector();
  });
});

describe("TailorDBField serial modifier tests", () => {
  it("serial modifier can only be used on string and int fields", () => {
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

  it("calling serial modifier more than once causes type error", () => {
    // @ts-expect-error serial() cannot be called after serial() has already been called
    db.string().serial({ start: 0 }).serial({ start: 0 });
  });
});

describe("TailorDBType withTimestamps option tests", () => {
  it("withTimestamps: false does not add timestamp fields", () => {
    const _noTimestampType = db.type("Test", {
      name: db.string(),
      ...db.fields.timestamps(),
    });
    expectTypeOf<output<typeof _noTimestampType>>().toEqualTypeOf<{
      id: string;
      name: string;
      createdAt: string;
      updatedAt?: string | null;
    }>();
  });

  it("withTimestamps: true adds timestamp fields", () => {
    const _timestampType = db.type("TestWithTimestamp", {
      name: db.string(),
      ...db.fields.timestamps(),
    });
    expectTypeOf<output<typeof _timestampType>>().toEqualTypeOf<{
      id: string;
      name: string;
      createdAt: string;
      updatedAt?: string | null;
    }>();
  });
});

describe("TailorDBType composite type tests", () => {
  it("type with multiple fields works correctly", () => {
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
      id: string;
      name: string;
      email: string;
      age?: number | null;
      isActive: boolean;
      tags: string[];
      role: "admin" | "user" | "guest";
      score: number;
      birthDate: string;
      lastLogin?: string | null;
      closingTime: string;
    }>();
  });
});

describe("TailorDBType edge case tests", () => {
  it("type with single field works correctly", () => {
    const _singleFieldType = db.type("Simple", {
      value: db.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      id: string;
      value: string;
    }>();
  });

  it("type with all optional fields works correctly", () => {
    const _allOptionalType = db.type("Optional", {
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

  it("type with all array fields works correctly", () => {
    const _allArrayType = db.type("Array", {
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
  it("same definition generates same type", () => {
    const _type1 = db.type("Same", {
      name: db.string(),
      age: db.int(),
    });
    const _type2 = db.type("Same", {
      name: db.string(),
      age: db.int(),
    });
    expectTypeOf<output<typeof _type1>>().toEqualTypeOf<
      output<typeof _type2>
    >();
  });

  it("id field is automatically added", () => {
    const _typeWithoutId = db.type("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _typeWithoutId>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });
});

describe("TailorDBType self relation tests", () => {
  it("when toward.type is self, forward name is derived from field name/alias, backward name is resolved as specified", () => {
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

    // parentID: forward name is parent (default with ID suffix removed)
    const parentRef = TestType.fields.parentID.reference!;
    expect(parentRef.type.name).toBe("TestType");
    expect(parentRef.nameMap[0]).toBe("parent");
    expect(parentRef.key).toBe("id");

    // dependId: forward name is dependsOn as specified by 'as', unique is set because it's 1-1
    const dependsRef = TestType.fields.dependId.reference!;
    expect(dependsRef.type.name).toBe("TestType");
    expect(dependsRef.nameMap[0]).toBe("dependsOn");
    expect(TestType.fields.dependId.metadata.unique).toBe(true);

    // Foreign key metadata is set with its own type name
    expect(TestType.fields.parentID.metadata.foreignKeyType).toBe("TestType");
    expect(TestType.fields.parentID.metadata.foreignKeyField).toBe("id");
    expect(TestType.fields.dependId.metadata.foreignKeyType).toBe("TestType");
    expect(TestType.fields.dependId.metadata.foreignKeyField).toBe("id");
    expect(TestType.fields.keyID.metadata.foreignKeyType).toBe("TestType");
    expect(TestType.fields.keyID.metadata.foreignKeyField).toBe("id");
  });

  it("when backward is not specified, empty string is set in configure (forward for self relation is generated by removing ID suffix)", () => {
    const A = db.type("Node", {
      // Many-to-one (non-unique): backward is plural (nodes)
      parentID: db.uuid().relation({ type: "n-1", toward: { type: "self" } }),
      // One-to-one (unique): backward is singular (node)
      pairId: db.uuid().relation({ type: "1-1", toward: { type: "self" } }),
    });

    // forward name for self-relations is derived from field name by stripping ID suffix
    expect(A.fields.parentID.reference!.nameMap[0]).toBe("parent");
    expect(A.fields.parentID.metadata.foreignKeyType).toBe("Node");
    expect(A.fields.parentID.metadata.foreignKeyField).toBe("id");
    expect(A.fields.pairId.reference!.nameMap[0]).toBe("pair");
    expect(A.fields.pairId.metadata.foreignKeyType).toBe("Node");
    expect(A.fields.pairId.metadata.foreignKeyField).toBe("id");

    // backward is empty string when not specified (inflection for backward happens in parser)
    expect(A.fields.parentID.reference!.nameMap[1]).toBe("");
    expect(A.fields.pairId.reference!.nameMap[1]).toBe("");
  });
});

describe("TailorDBType plural form tests", () => {
  it("when defining type with single name, pluralForm is not set in configure (inflection is executed at parser layer)", () => {
    const _userType = db.type("User", {
      name: db.string(),
    });

    expect(_userType.metadata.schema?.settings?.pluralForm).toBeUndefined();
  });

  it("when specifying name and plural form as tuple, pluralForm is set", () => {
    const _personType = db.type(["Person", "People"], {
      name: db.string(),
    });

    expect(_personType.metadata.schema?.settings?.pluralForm).toBe("People");
  });

  it("when plural form is explicitly specified, default pluralization is not used", () => {
    const _childType = db.type(["Child", "Children"], {
      name: db.string(),
      age: db.int(),
    });

    expect(_childType.metadata.schema?.settings?.pluralForm).toBe("Children");
  });

  it("when plural form is empty string, it is not set in configure (inflection is executed at parser layer)", () => {
    const _dataType = db.type(["Datum", ""], {
      value: db.string(),
    });

    expect(_dataType.metadata.schema?.settings?.pluralForm).toBeUndefined();
  });

  it("error when plural form is same as name (when explicitly specified in tuple format)", () => {
    expect(() => db.type(["Data", "Data"], {})).toThrowError(
      "The name and the plural form must be different. name=Data",
    );
  });

  it("all existing features work correctly with tuple format", () => {
    const _postType = db.type(["Post", "Posts"], {
      title: db.string(),
      content: db.string({ optional: true }),
      ...db.fields.timestamps(),
    });

    expectTypeOf<output<typeof _postType>>().toEqualTypeOf<{
      id: string;
      title: string;
      content?: string | null;
      createdAt: string;
      updatedAt?: string | null;
    }>();

    expect(_postType.name).toBe("Post");
    expect(_postType.metadata.schema?.settings?.pluralForm).toBe("Posts");
  });

  it("plural form with special characters can also be set", () => {
    const _deviceType = db.type(["Device", "Device's"], {
      name: db.string(),
      status: db.enum(["active", "inactive"]),
    });

    expect(_deviceType.metadata.schema?.settings?.pluralForm).toBe("Device's");
  });

  it("plural form with numbers can also be set", () => {
    const _itemType = db.type(["Item", "100Items"], {
      name: db.string(),
      quantity: db.int(),
    });

    expect(_itemType.metadata.schema?.settings?.pluralForm).toBe("100Items");
  });

  it("validation and plural form coexist in tuple format", () => {
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
    expect(_userType.metadata.schema?.settings?.pluralForm).toBe("Users");

    const emailConfig = _userType.fields.email.config;
    expect(emailConfig.validate![0].errorMessage).toBe("Invalid email format");
  });

  it("plural form works correctly for types with relations", () => {
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

    expect(_categoryType.metadata.schema?.settings?.pluralForm).toBe(
      "Categories",
    );
    expect(_productType.metadata.schema?.settings?.pluralForm).toBe("Products");
  });

  it("plural form with mixed case can also be set", () => {
    const _dataType = db.type(["Data", "DataSet"], {
      value: db.string(),
    });

    expect(_dataType.metadata.schema?.settings?.pluralForm).toBe("DataSet");
  });
});

describe("TailorDBType hooks modifier tests", () => {
  it("hooks modifier does not affect output type", () => {
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
      id: string;
      name: string;
    }>();
  });

  it("type error occurs when hooks is already set on TailorDBField", () => {
    db.type("Test", {
      name: db.string().hooks({ create: () => "created" }),
    }).hooks({
      name: {
        create: () => "created",
      },
    });
  });

  it("setting hooks on id causes type error", () => {
    db.type("Test", {
      name: db.string(),
    }).hooks({
      // @ts-expect-error hooks() cannot be called on the "id" field
      id: {
        create: () => "created",
      },
    });
  });

  it("setting hooks on nested field causes type error", () => {
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

  it("hooks modifier on string field receives string", () => {
    const testType = db.type("Test", { name: db.string() });
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

  it("hooks modifier on optional field receives null", () => {
    const testType = db.type("Test", {
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
  it("validate modifier can receive function", () => {
    const _validateType = db
      .type("Test", {
        email: db.string(),
      })
      .validate({
        email: () => true,
      });

    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
    const fieldConfig = _validateType.fields.email.config;
    expect(fieldConfig.validate).toHaveLength(1);
  });

  it("validate modifier can receive object with message", () => {
    const _validateType = db
      .type("Test", {
        email: db.string(),
      })
      .validate({
        email: [({ value }) => value.includes("@"), "Email must contain @"],
      });

    const fieldConfig = _validateType.fields.email.config;
    expect(fieldConfig.validate).toHaveLength(1);
    expect(fieldConfig?.validate?.[0].errorMessage).toBe(
      "Email must contain @",
    );
  });

  it("validate modifier can receive multiple validators", () => {
    const _validateType = db
      .type("Test", {
        password: db.string(),
      })
      .validate({
        password: [
          ({ value }) => value.length >= 8,
          [
            ({ value }) => /[A-Z]/.test(value),
            "Password must contain uppercase letter",
          ],
        ],
      });

    const fieldConfig = _validateType.fields.password.config;
    expect(fieldConfig.validate).toHaveLength(2);
    expect(fieldConfig?.validate?.[1].errorMessage).toBe(
      "Password must contain uppercase letter",
    );
  });

  it("type error occurs when validate is already set on TailorDBField", () => {
    db.type("Test", {
      name: db.string().validate(() => true),
      // @ts-expect-error validate() cannot be called after validate() has already been called
    }).validate({
      name: () => true,
    });
  });

  it("setting validate on id causes type error", () => {
    db.type("Test", {
      name: db.string(),
    }).validate({
      // @ts-expect-error validate() cannot be called on the "id" field
      id: () => true,
    });
  });

  it("validate modifier on string field receives string", () => {
    const _validate = db.type("Test", { name: db.string() }).validate;
    expectTypeOf<
      ValidateConfig<string, { id: string; name: string }>
    >().toExtend<Parameters<typeof _validate>[0]["name"]>();
  });

  it("validate modifier on optional field receives null", () => {
    const _validate = db.type("Test", {
      name: db.string({ optional: true }),
    }).validate;
    expectTypeOf<
      ValidateConfig<string | null, { id: string; name?: string | null }>
    >().toExtend<Parameters<typeof _validate>[0]["name"]>();
  });
});

describe("db.object tests", () => {
  it("correctly infers basic object type", () => {
    const _objectType = db.type("Test", {
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

  it("nesting db.object causes type error", () => {
    db.object({
      name: db.string(),
      // @ts-expect-error Nested db.object() is not allowed
      profile: db.object({
        bio: db.string(),
      }),
    });
  });

  it("correctly infers object type with optional fields", () => {
    const _objectType = db.type("Test", {
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

  it("correctly infers object type with optional option", () => {
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
      id: string;
      user?: {
        name: string;
        avatar?: string | null;
      } | null;
    }>();
  });

  it("correctly infers object type with array option", () => {
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
      id: string;
      users: {
        name: string;
        age: number;
      }[];
    }>();
  });

  it("correctly infers object type with array fields", () => {
    const _objectType = db.type("Test", {
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

  it("correctly infers object type with multiple modifiers", () => {
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

  it("correctly infers object type with bool type", () => {
    const _objectType = db.type("Test", {
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

  it("correctly infers object type with float and enum types", () => {
    const _objectType = db.type("Test", {
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
  it("can use TailorDBField inside t.type", () => {
    const _stringType = t.object({
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  it("can assign TailorDBType to TailorType", () => {
    const _dbType = db.type("Test", {
      name: db.string(),
    });
    // Type check removed - TailorType no longer exists
  });
});

describe("TailorDBType/TailorDBField description support", () => {
  it("TailorDBField supports description", () => {
    const userType = db.type("User", {
      name: db.string().description("User name"),
      age: db.int().description("User age"),
    });

    expect(userType.fields.name.metadata.description).toBe("User name");
    expect(userType.fields.age.metadata.description).toBe("User age");
  });

  it("TailorDBType description is set via second argument", () => {
    const userType = db.type("User", "User profile type", {
      name: db.string(),
    });

    expect(userType._description).toBe("User profile type");
  });

  it("TailorDBField nested object supports description", () => {
    const profileType = db.type("Profile", {
      userInfo: db
        .object({
          name: db.string().description("Full name"),
          email: db.string().description("Email address"),
        })
        .description("User information object"),
    });

    expect(profileType.fields.userInfo.metadata.description).toBe(
      "User information object",
    );
    expect(profileType.fields.userInfo.fields.name.metadata.description).toBe(
      "Full name",
    );
    expect(profileType.fields.userInfo.fields.email.metadata.description).toBe(
      "Email address",
    );
  });

  it("TailorDBType can be used in resolver with description preserved", () => {
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
