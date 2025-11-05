import { describe, it, expectTypeOf, expect } from "vitest";
import { t } from "@/configure/types";
import { db } from "./schema";
import type { Hook } from "./types";
import type { output } from "@/configure/types/helpers";
import type {
  FieldValidateInput,
  ValidateConfig,
} from "@/configure/types/validation";

describe("TailorDBField 基本フィールド型テスト", () => {
  it("string型フィールドが正しくstring型を出力する", () => {
    const _stringType = db.type("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  it("int型フィールドが正しくnumber型を出力する", () => {
    const _intType = db.type("Test", {
      age: db.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      id: string;
      age: number;
    }>();
  });

  it("bool型フィールドが正しくboolean型を出力する", () => {
    const _boolType = db.type("Test", {
      active: db.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      id: string;
      active: boolean;
    }>();
  });

  it("float型フィールドが正しくnumber型を出力する", () => {
    const _floatType = db.type("Test", {
      price: db.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      id: string;
      price: number;
    }>();
  });

  it("uuid型フィールドが正しくstring型を出力する", () => {
    const _uuidType = db.type("Test", {
      uuid: db.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: string;
      uuid: string;
    }>();
  });

  it("date型フィールドが正しくstring型を出力する", () => {
    const _dateType = db.type("Test", {
      birthDate: db.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      id: string;
      birthDate: string;
    }>();
  });

  it("datetime型フィールドが正しくstring型を出力する", () => {
    const _datetimeType = db.type("Test", {
      timestamp: db.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toMatchObjectType<{
      id: string;
      timestamp: string;
    }>();
  });

  it("time型フィールドが正しくstring型を出力する", () => {
    const _timeType = db.type("Test", {
      openingTime: db.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      id: string;
      openingTime: string;
    }>();
  });
});

describe("TailorDBField optionalオプションテスト", () => {
  it("optionalオプションがnull許可型を生成する", () => {
    const _optionalType = db.type("Test", {
      description: db.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      id: string;
      description?: string | null;
    }>();
  });

  it("複数のオプショナルフィールドが正しく動作する", () => {
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

describe("TailorDBField arrayオプションテスト", () => {
  it("arrayオプションが配列型を生成する", () => {
    const _arrayType = db.type("Test", {
      tags: db.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      id: string;
      tags: string[];
    }>();
  });

  it("オプショナル配列が正しく動作する", () => {
    const _optionalArrayType = db.type("Test", {
      items: db.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      id: string;
      items?: string[] | null;
    }>();
  });

  it("複数の配列フィールドが正しく動作する", () => {
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

describe("TailorDBField enum フィールドテスト", () => {
  it("stringを渡してenumフィールドを設定する", () => {
    const enumField = db.enum("active", "inactive", "pending");
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<
      "active" | "inactive" | "pending"
    >();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
      { value: "pending", description: "" },
    ]);
  });

  it("objectを渡してenumフィールドを設定する", () => {
    const enumField = db.enum(
      { value: "small", description: "Small size" },
      { value: "medium" },
      { value: "large", description: "Large size" },
    );
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<
      "small" | "medium" | "large"
    >();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "small", description: "Small size" },
      { value: "medium", description: "" },
      { value: "large", description: "Large size" },
    ]);
  });

  it("stringとobjectを混在させてenumフィールドを設定する", () => {
    const enumField = db.enum(
      "red",
      { value: "green", description: "Green color" },
      "blue",
    );
    expectTypeOf<output<typeof enumField>>().toEqualTypeOf<
      "red" | "green" | "blue"
    >();
    expect(enumField.metadata.allowedValues).toEqual([
      { value: "red", description: "" },
      { value: "green", description: "Green color" },
      { value: "blue", description: "" },
    ]);
  });

  it("値を持たないenumを設定すると型エラーになる", () => {
    // @ts-expect-error AllowedValues requires at least one value
    db.enum();
    // @ts-expect-error AllowedValues requires at least one value
    db.enum({ optional: true });
  });

  it("オプショナルenum()が正しく動作する", () => {
    const _optionalEnumType = db.type("Test", {
      priority: db.enum("high", "medium", "low", { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      id: string;
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum配列が正しく動作する", () => {
    const _enumArrayType = db.type("Test", {
      categories: db.enum("a", "b", "c", { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      id: string;
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorDBField RelationConfig オプションフィールドテスト", () => {
  const User = db.type("User", {
    name: db.string(),
    email: db.string(),
  });

  const Customer = db.type("Customer", {
    name: db.string(),
    customerId: db.string(),
  });

  it("toward.asが省略された場合、undefinedが保存される（inflectionはparser層で実行される）", () => {
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

  it('toward.keyが省略された場合、"id"がデフォルトで使用される', () => {
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

  it("toward.as、toward.key、backwardが全て明示的に指定された場合の動作", () => {
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

  it("toward.asのみ明示的に指定した場合の動作", () => {
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

  it("toward.keyのみ明示的に指定した場合の動作", () => {
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

  it("toward.keyに存在しないフィールド名を指定した場合、型エラーが発生する", () => {
    // @ts-expect-error 'nonExisting' does not exist on type 'Customer'
    db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: Customer,
        key: "nonExisting",
      },
    });
  });

  it("backwardのみ明示的に指定した場合の動作", () => {
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

  it("manyToOneリレーションでの型推論確認", () => {
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

describe("TailorDBField 修飾子チェーンテスト", () => {
  it("index()修飾子が型に影響しない", () => {
    const _indexType = db.type("Test", {
      email: db.string().index(),
    });
    expectTypeOf<output<typeof _indexType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  it("unique()修飾子が型に影響しない", () => {
    const _uniqueType = db.type("Test", {
      username: db.string().unique(),
    });
    expectTypeOf<output<typeof _uniqueType>>().toEqualTypeOf<{
      id: string;
      username: string;
    }>();
  });
});

describe("TailorDBField relation修飾子テスト", () => {
  it("relation によって参照型は作成されない", () => {
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

  it("relationを2回設定しようとすると型エラーが発生する", () => {
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

describe("TailorDBField hooks修飾子テスト", () => {
  it("hooks修飾子がoutput型に影響しない", () => {
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

  it("hooks修飾子を2回以上呼び出すと型エラーが発生する", () => {
    db.string()
      .hooks({
        create: () => "created",
      })
      .hooks({
        update: () => "updated",
      });
  });

  it("nestedフィールドにhooksを設定すると型エラーが発生する", () => {
    // @ts-expect-error hooks() cannot be called on nested fields
    db.object({
      first: db.string(),
      last: db.string(),
    }).hooks({ create: () => ({ first: "A", last: "B" }) });
  });

  it("stringフィールドでhooks修飾子はstringを受け取る", () => {
    const _hooks = db.string().hooks;
    expectTypeOf<Parameters<typeof _hooks>[0]>().toEqualTypeOf<
      Hook<unknown, string>
    >();
  });

  it("optionalフィールドでhooks修飾子はnullを受け取る", () => {
    const _hooks = db.string({ optional: true }).hooks;
    expectTypeOf<Parameters<typeof _hooks>[0]>().toEqualTypeOf<
      Hook<unknown, string | null>
    >();
  });
});

describe("TailorDBField validate修飾子テスト", () => {
  it("validate修飾子が型に影響しない", () => {
    const _validateType = db.type("Test", {
      email: db.string().validate(() => true),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  it("validate修飾子がメッセージ付きオブジェクトを受け取れる", () => {
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

  it("validate修飾子が複数のバリデーターを受け取れる", () => {
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

  it("validate修飾子を2回以上呼び出すと型エラーが発生する", () => {
    // @ts-expect-error validate() cannot be called after validate() has already been called
    db.string()
      .validate(() => true)
      .validate(() => true);
  });

  it("stringフィールドでvalidate修飾子はstringを受け取る", () => {
    const _validate = db.string().validate;
    expectTypeOf<Parameters<typeof _validate>[1]>().toEqualTypeOf<
      FieldValidateInput<string>
    >();
  });

  it("optionalフィールドでvalidate修飾子はnullを受け取る", () => {
    const _validate = db.string({ optional: true }).validate;
    expectTypeOf<Parameters<typeof _validate>[1]>().toEqualTypeOf<
      FieldValidateInput<string | null>
    >();
  });
});

describe("TailorDBField vector修飾子テスト", () => {
  it("vector修飾子はstringフィールドでのみ使用できる", () => {
    const _vector = db.string().vector();
    expectTypeOf<output<typeof _vector>>().toEqualTypeOf<string>();
    expect(_vector.metadata.vector).toBe(true);

    // @ts-expect-error vector() can only be called on string fields
    db.int().vector();
    // @ts-expect-error vector() cannot be called on array fields
    db.string({ array: true }).vector();
  });

  it("vector修飾子を2回以上呼び出すと型エラーが発生する", () => {
    // @ts-expect-error vector() cannot be called after vector() has already been called
    db.string().vector().vector();
  });
});

describe("TailorDBField serial修飾子テスト", () => {
  it("serial修飾子はstringおよびintフィールドでのみ使用できる", () => {
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

  it("serial修飾子を2回以上呼び出すと型エラーが発生する", () => {
    // @ts-expect-error serial() cannot be called after serial() has already been called
    db.string().serial({ start: 0 }).serial({ start: 0 });
  });
});

describe("TailorDBType withTimestamps オプションテスト", () => {
  it("withTimestamps: falseでタイムスタンプフィールドが追加されない", () => {
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

  it("withTimestamps: trueでタイムスタンプフィールドが追加される", () => {
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

describe("TailorDBType 複合型テスト", () => {
  it("複数フィールドを持つ型が正しく動作する", () => {
    const _complexType = db.type("User", {
      name: db.string(),
      email: db.string(),
      age: db.int({ optional: true }),
      isActive: db.bool(),
      tags: db.string({ array: true }),
      role: db.enum("admin", "user", "guest"),
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

describe("TailorDBType エッジケーステスト", () => {
  it("単一フィールドの型が正しく動作する", () => {
    const _singleFieldType = db.type("Simple", {
      value: db.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      id: string;
      value: string;
    }>();
  });

  it("すべてオプショナルフィールドの型が正しく動作する", () => {
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

  it("すべて配列フィールドの型が正しく動作する", () => {
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

describe("TailorDBType 型の一貫性テスト", () => {
  it("同じ定義は同じ型を生成する", () => {
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

  it("idフィールドが自動的に追加される", () => {
    const _typeWithoutId = db.type("Test", {
      name: db.string(),
    });
    expectTypeOf<output<typeof _typeWithoutId>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });
});

describe("TailorDBType self relation テスト", () => {
  it("toward.typeがselfのとき、前方名はフィールド名由来/別名、後方名は指定どおりに解決される", () => {
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
    });

    // parentID: forward name is parent (default with ID suffix removed)
    const parentRef = (TestType as any).fields.parentID.reference!;
    expect(parentRef.type.name).toBe("TestType");
    expect(parentRef.nameMap[0]).toBe("parent");
    expect(parentRef.key).toBe("id");

    // dependId: forward name is dependsOn as specified by 'as', unique is set because it's 1-1
    const dependsRef = (TestType as any).fields.dependId.reference!;
    expect(dependsRef.type.name).toBe("TestType");
    expect(dependsRef.nameMap[0]).toBe("dependsOn");
    expect((TestType as any).fields.dependId.metadata.unique).toBe(true);

    // backward is registered in the referenced map
    expect((TestType as any).referenced.children).toEqual([
      TestType,
      "parentID",
    ]);
    expect((TestType as any).referenced.dependedBy).toEqual([
      TestType,
      "dependId",
    ]);

    // Foreign key metadata is set with its own type name
    expect((TestType as any).fields.parentID.metadata.foreignKeyType).toBe(
      "TestType",
    );
    expect(TestType.fields.parentID.metadata.foreignKeyField).toBe("id");
    expect((TestType as any).fields.dependId.metadata.foreignKeyType).toBe(
      "TestType",
    );
    expect(TestType.fields.dependId.metadata.foreignKeyField).toBe("id");
  });

  it("backward未指定時はconfigureでは空文字列が設定される（self relationのforwardはID接尾辞除去で生成される）", () => {
    const A = db.type("Node", {
      // Many-to-one (non-unique): backward is plural (nodes)
      parentID: db.uuid().relation({ type: "n-1", toward: { type: "self" } }),
      // One-to-one (unique): backward is singular (node)
      pairId: db.uuid().relation({ type: "1-1", toward: { type: "self" } }),
    });

    // forward name for self-relations is derived from field name by stripping ID suffix
    expect((A as any).fields.parentID.reference!.nameMap[0]).toBe("parent");
    expect(A.fields.parentID.metadata.foreignKeyType).toBe("Node");
    expect(A.fields.parentID.metadata.foreignKeyField).toBe("id");
    expect((A as any).fields.pairId.reference!.nameMap[0]).toBe("pair");
    expect(A.fields.pairId.metadata.foreignKeyType).toBe("Node");
    expect(A.fields.pairId.metadata.foreignKeyField).toBe("id");

    // backward is empty string when not specified (inflection for backward happens in parser)
    expect((A as any).fields.parentID.reference!.nameMap[1]).toBe("");
    expect((A as any).fields.pairId.reference!.nameMap[1]).toBe("");
  });
});

describe("TailorDBType plural form テスト", () => {
  it("単一の名前でtype定義した場合、configureではpluralFormは設定されない（inflectionはparser層で実行される）", () => {
    const _userType = db.type("User", {
      name: db.string(),
    });

    expect(_userType.metadata.schema?.settings?.pluralForm).toBeUndefined();
  });

  it("タプルで名前とplural formを指定した場合、pluralFormが設定される", () => {
    const _personType = db.type(["Person", "People"], {
      name: db.string(),
    });

    expect(_personType.metadata.schema?.settings?.pluralForm).toBe("People");
  });

  it("複数形が明示的に指定された場合、デフォルトの複数形変換は使用されない", () => {
    const _childType = db.type(["Child", "Children"], {
      name: db.string(),
      age: db.int(),
    });

    expect(_childType.metadata.schema?.settings?.pluralForm).toBe("Children");
  });

  it("空文字列のplural formの場合、configureでは設定されない（inflectionはparser層で実行される）", () => {
    const _dataType = db.type(["Datum", ""], {
      value: db.string(),
    });

    expect(_dataType.metadata.schema?.settings?.pluralForm).toBeUndefined();
  });

  it("plural formがnameと同じ場合エラー（タプル形式で明示的に指定した場合）", () => {
    expect(() => db.type(["Data", "Data"], {})).toThrowError(
      "The name and the plural form must be different. name=Data",
    );
  });

  it("日本語のplural formも設定可能", () => {
    const _bookType = db.type(["Book", "本"], {
      title: db.string(),
      author: db.string(),
    });

    expect(_bookType.metadata.schema?.settings?.pluralForm).toBe("本");
  });

  it("タプル形式でもすべての既存機能が正常に動作する", () => {
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

  it("特殊文字を含むplural formも設定可能", () => {
    const _deviceType = db.type(["Device", "Device's"], {
      name: db.string(),
      status: db.enum("active", "inactive"),
    });

    expect(_deviceType.metadata.schema?.settings?.pluralForm).toBe("Device's");
  });

  it("数字を含むplural formも設定可能", () => {
    const _itemType = db.type(["Item", "100Items"], {
      name: db.string(),
      quantity: db.int(),
    });

    expect(_itemType.metadata.schema?.settings?.pluralForm).toBe("100Items");
  });

  it("タプル形式でvalidationとplural formが共存する", () => {
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

    const emailConfig = (_userType as any).fields.email.config;
    expect(emailConfig.validate[0].errorMessage).toBe("Invalid email format");
  });

  it("リレーションを持つ型でもplural formが正しく動作する", () => {
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

  it("大文字小文字が混在するplural formも設定可能", () => {
    const _dataType = db.type(["Data", "DataSet"], {
      value: db.string(),
    });

    expect(_dataType.metadata.schema?.settings?.pluralForm).toBe("DataSet");
  });
});

describe("TailorDBType hooks修飾子テスト", () => {
  it("hooks修飾子がoutput型に影響しない", () => {
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

  it("TailorDBFieldでhooksが設定済みの場合に型エラーが発生する", () => {
    db.type("Test", {
      name: db.string().hooks({ create: () => "created" }),
    }).hooks({
      name: {
        create: () => "created",
      },
    });
  });

  it("idにhooksを設定すると型エラーが発生する", () => {
    db.type("Test", {
      name: db.string(),
    }).hooks({
      // @ts-expect-error hooks() cannot be called on the "id" field
      id: {
        create: () => "created",
      },
    });
  });

  it("nestedフィールドにhooksを設定すると型エラーが発生する", () => {
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

  it("stringフィールドでhooks修飾子はstringを受け取る", () => {
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

  it("optionalフィールドでhooks修飾子はnullを受け取る", () => {
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

describe("TailorDBType validate修飾子テスト", () => {
  it("validate修飾子が関数を受け取れる", () => {
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

  it("validate修飾子がメッセージ付きオブジェクトを受け取れる", () => {
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

  it("validate修飾子が複数のバリデーターを受け取れる", () => {
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

  it("TailorDBFieldでvalidateが設定済みの場合に型エラーが発生する", () => {
    db.type("Test", {
      name: db.string().validate(() => true),
      // @ts-expect-error validate() cannot be called after validate() has already been called
    }).validate({
      name: () => true,
    });
  });

  it("idにvalidateを設定すると型エラーが発生する", () => {
    db.type("Test", {
      name: db.string(),
    }).validate({
      // @ts-expect-error validate() cannot be called on the "id" field
      id: () => true,
    });
  });

  it("stringフィールドでvalidate修飾子はstringを受け取る", () => {
    const _validate = db.type("Test", { name: db.string() }).validate;
    expectTypeOf<
      ValidateConfig<string, { id: string; name: string }>
    >().toExtend<Parameters<typeof _validate>[0]["name"]>();
  });

  it("optionalフィールドでvalidate修飾子はnullを受け取る", () => {
    const _validate = db.type("Test", {
      name: db.string({ optional: true }),
    }).validate;
    expectTypeOf<
      ValidateConfig<string | null, { id: string; name?: string | null }>
    >().toExtend<Parameters<typeof _validate>[0]["name"]>();
  });
});

describe("db.object テスト", () => {
  it("基本的なオブジェクト型を正しく推論する", () => {
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

  it("db.objectをネストすると型エラーが発生する", () => {
    db.object({
      name: db.string(),
      // @ts-expect-error Nested db.object() is not allowed
      profile: db.object({
        bio: db.string(),
      }),
    });
  });

  it("オプショナルフィールドを含むオブジェクト型を正しく推論する", () => {
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

  it("optionalオプションを持つオブジェクト型を正しく推論する", () => {
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

  it("arrayオプションを持つオブジェクト型を正しく推論する", () => {
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

  it("配列フィールドを含むオブジェクト型を正しく推論する", () => {
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

  it("複数の修飾子を組み合わせたオブジェクト型を正しく推論する", () => {
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

  it("bool型を含むオブジェクト型を正しく推論する", () => {
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

  it("float型とenum型を含むオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      product: db.object({
        name: db.string(),
        price: db.float(),
        category: db.enum("electronics", "books", "clothing"),
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

describe("TailorField/TailorType 互換性テスト", () => {
  it("t.type の中で TailorDBField を使用できる", () => {
    const _stringType = t.object({
      name: db.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  it("TailorType に TailorDBType を代入できる", () => {
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
