import { describe, it, expectTypeOf, expect } from "vitest";
import { db } from "./schema";
import type { output } from "@/types/helpers";
import inflection from "inflection";

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

  it("date型フィールドが正しくDate型を出力する", () => {
    const _dateType = db.type("Test", {
      birthDate: db.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      id: string;
      birthDate: string;
    }>();
  });

  it("datetime型フィールドが正しくDate型を出力する", () => {
    const _datetimeType = db.type("Test", {
      timestamp: db.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toMatchObjectType<{
      id: string;
      timestamp: string;
    }>();
  });

  it("time型フィールドが正しくDate型を出力する", () => {
    const _timeType = db.type("Test", {
      openingTime: db.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      id: string;
      openingTime: string;
    }>();
  });
});

describe("TailorDBField オプショナル修飾子テスト", () => {
  it("optional()修飾子がnull許可型を生成する", () => {
    const _optionalType = db.type("Test", {
      description: db.string().optional(),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      id: string;
      description?: string | null;
    }>();
  });

  it("複数のオプショナルフィールドが正しく動作する", () => {
    const _multiOptionalType = db.type("Test", {
      title: db.string(),
      description: db.string().optional(),
      count: db.int().optional(),
    });
    expectTypeOf<output<typeof _multiOptionalType>>().toEqualTypeOf<{
      id: string;
      title: string;
      description?: string | null;
      count?: number | null;
    }>();
  });
});

describe("TailorDBField 配列修飾子テスト", () => {
  it("array()修飾子が配列型を生成する", () => {
    const _arrayType = db.type("Test", {
      tags: db.string().array(),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      id: string;
      tags: string[];
    }>();
  });

  it("オプショナル配列が正しく動作する", () => {
    const _optionalArrayType = db.type("Test", {
      items: db.string().array().optional(),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      id: string;
      items?: string[] | null;
    }>();
  });

  it("複数の配列フィールドが正しく動作する", () => {
    const _multiArrayType = db.type("Test", {
      tags: db.string().array(),
      numbers: db.int().array(),
      flags: db.bool().array(),
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
  it("enum()でユニオン型を生成する", () => {
    const _enumType = db.type("Test", {
      status: db.enum("active", "inactive", "pending"),
    });
    expectTypeOf<output<typeof _enumType>>().toEqualTypeOf<{
      id: string;
      status: "active" | "inactive" | "pending";
    }>();
  });

  it("オプショナルenum()が正しく動作する", () => {
    const _optionalEnumType = db.type("Test", {
      priority: db.enum("high", "medium", "low").optional(),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      id: string;
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum配列が正しく動作する", () => {
    const _enumArrayType = db.type("Test", {
      categories: db.enum("a", "b", "c").array(),
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

  it("toward.asが省略された場合、toward.type.nameがデフォルトで使用される", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        key: "id",
      },
    });

    expect(userField.reference!.nameMap[0]).toEqual("user");
    expect(userField.reference!.nameMap[1]).toEqual("");
  });

  it('toward.keyが省略された場合、"id"がデフォルトで使用される', () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
        as: "owner",
      },
    });

    expectTypeOf(userField.reference!.key).toEqualTypeOf<"id">();
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
  });

  it("toward.keyのみ明示的に指定した場合の動作", () => {
    const customerField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: Customer,
        key: "customerId",
      },
    });

    expect(customerField.reference!.nameMap[0]).toEqual("customer");
    expect(customerField.reference!.key).toEqual("customerId");
    expect(customerField.reference!.nameMap[1]).toEqual("");
  });

  it("backwardのみ明示的に指定した場合の動作", () => {
    const userField = db.uuid().relation({
      type: "oneToOne",
      toward: {
        type: User,
      },
      backward: "relatedItems",
    });

    expect(userField.reference!.nameMap[0]).toEqual("user");
    expect(userField.reference!.key).toEqual("id");
    expect(userField.reference!.nameMap[1]).toEqual("relatedItems");
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

  it("vector()修飾子が型に影響しない", () => {
    const _vectorType = db.type("Test", {
      embedding: db.string().vector(),
    });
    expectTypeOf<output<typeof _vectorType>>().toEqualTypeOf<{
      id: string;
      embedding: string;
    }>();
  });

  it("validate()修飾子が型に影響しない", () => {
    const _validateType = db.type("Test", {
      email: db.string().validate(() => true),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();
  });

  it("validate()修飾子がメッセージ付きオブジェクトを受け取れる", () => {
    const _validateType = db.type("Test", {
      email: db
        .string()
        .validate([
          ({ value }: { value: string }) => value.includes("@"),
          "Email must contain @",
        ]),
    });
    expectTypeOf<output<typeof _validateType>>().toEqualTypeOf<{
      id: string;
      email: string;
    }>();

    // Test that the field config is generated correctly
    const fieldConfig = (_validateType as any).fields.email.config;
    expect(fieldConfig.validate).toBeDefined();
    expect(fieldConfig.validate[0].errorMessage).toBe("Email must contain @");
  });

  it("validate()修飾子が複数のバリデーターを受け取れる", () => {
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

    const fieldConfig = (_validateType as any).fields.password.config;
    expect(fieldConfig.validate).toHaveLength(2);
    expect(fieldConfig.validate[1].errorMessage).toBe(
      "Password must contain uppercase letter",
    );
  });

  it("修飾子の順序が結果に影響しない", () => {
    const _chainType1 = db.type("Test", {
      field: db.string().optional().array(),
    });
    const _chainType2 = db.type("Test", {
      field: db.string().array().optional(),
    });
    expectTypeOf<output<typeof _chainType1>>().toEqualTypeOf<
      output<typeof _chainType2>
    >();
  });
});

describe("TailorDBField ref修飾子テスト", () => {
  it("ref()修飾子が参照型を生成する", () => {
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
      author: {
        id: string;
        name: string;
      };
    }>();
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
      age: db.int().optional(),
      isActive: db.bool(),
      tags: db.string().array(),
      role: db.enum("admin", "user", "guest"),
      score: db.float(),
      birthDate: db.date(),
      lastLogin: db.datetime().optional(),
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
      a: db.string().optional(),
      b: db.int().optional(),
      c: db.bool().optional(),
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
      strings: db.string().array(),
      numbers: db.int().array(),
      booleans: db.bool().array(),
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
    expectTypeOf<output<typeof _typeWithoutId>>().toMatchTypeOf<{
      id: string;
    }>();
  });

  it("type-level validate method should exist and work", () => {
    const _userType = db.type("User", {
      name: db.string(),
      email: db.string(),
    });

    // Test that the validate method exists
    const result = _userType.validate({
      name: [({ value }) => value.length > 0],
      email: [({ value }) => value.includes("@")],
    });

    // Should return the same type instance for chaining
    expect(result).toBe(_userType);
  });

  it("type-level validate method should accept message objects", () => {
    const _userType = db.type("User", {
      name: db.string(),
      email: db.string(),
    });

    // Test that the validate method accepts both function and object formats
    const result = _userType.validate({
      name: [
        ({ value }) => value.length > 0,
        [
          ({ value }) => value.length <= 50,
          "Name must be 50 characters or less",
        ],
      ],
      email: [({ value }) => value.includes("@"), "Email must be valid"],
    });

    // Should return the same type instance for chaining
    expect(result).toBe(_userType);

    // Check that fields have correct validation config
    const nameConfig = (_userType as any).fields.name.config;
    expect(nameConfig.validate).toHaveLength(2);
    expect(nameConfig.validate[1].errorMessage).toBe(
      "Name must be 50 characters or less",
    );

    const emailConfig = (_userType as any).fields.email.config;
    expect(emailConfig.validate).toHaveLength(1);
    expect(emailConfig.validate[0].errorMessage).toBe("Email must be valid");
  });
});

describe("TailorDBType plural form テスト", () => {
  it("単一の名前でtype定義した場合でも、pluralFormがinflectionで設定される", () => {
    const _userType = db.type("User", {
      name: db.string(),
    });

    expect(_userType.metadata.schema?.settings?.pluralForm).toBe("Users");
    expect(_userType.metadata.schema?.settings?.pluralForm).toBe(
      inflection.pluralize("User"),
    );
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

  it("空文字列のplural formの場合、inflectionで設定される", () => {
    const _dataType = db.type(["Datum", ""], {
      value: db.string(),
    });

    expect(_dataType.metadata.schema?.settings?.pluralForm).toBe(
      inflection.pluralize("Data"),
    );
    expect(_dataType.metadata.schema?.settings?.pluralForm).toBe(
      inflection.pluralize("Datum"),
    );
  });

  it("plural formがnameと同じ場合エラー", () => {
    expect(() => db.type("Data", {})).toThrowError(
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
      content: db.string().optional(),
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

  it("オプショナルフィールドを含むオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      user: db.object({
        name: db.string(),
        age: db.int().optional(),
        email: db.string().optional(),
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

  it("ネストしたオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      user: db.object({
        name: db.string(),
        address: db.object({
          street: db.string(),
          city: db.string(),
          zipCode: db.string().optional(),
        }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      user: {
        name: string;
        address: {
          street: string;
          city: string;
          zipCode?: string | null;
        };
      };
    }>();
  });

  it("オプショナル修飾子を持つオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      user: db
        .object({
          name: db.string(),
          profile: db.object({
            bio: db.string(),
            avatar: db.string().optional(),
          }),
        })
        .optional(),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      user?: {
        name: string;
        profile: {
          bio: string;
          avatar?: string | null;
        };
      } | null;
    }>();
  });

  it("配列修飾子を持つオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      users: db
        .object({
          name: db.string(),
          age: db.int(),
        })
        .array(),
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
        tags: db.string().array(),
        scores: db.int().array(),
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
      optionalUsers: db
        .object({
          name: db.string(),
          age: db.int().optional(),
          tags: db.string().array(),
        })
        .array()
        .optional(),
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

  it("深くネストしたオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      company: db.object({
        name: db.string(),
        departments: db
          .object({
            name: db.string(),
            employees: db
              .object({
                name: db.string(),
                position: db.string(),
                contact: db.object({
                  email: db.string(),
                  phone: db.string().optional(),
                }),
              })
              .array(),
          })
          .array(),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      company: {
        name: string;
        departments: {
          name: string;
          employees: {
            name: string;
            position: string;
            contact: {
              email: string;
              phone?: string | null;
            };
          }[];
        }[];
      };
    }>();
  });

  it("bool型を含むオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      settings: db.object({
        enabled: db.bool(),
        notifications: db.object({
          email: db.bool(),
          push: db.bool().optional(),
        }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      settings: {
        enabled: boolean;
        notifications: {
          email: boolean;
          push?: boolean | null;
        };
      };
    }>();
  });

  it("float型とenum型を含むオブジェクト型を正しく推論する", () => {
    const _objectType = db.type("Test", {
      product: db.object({
        name: db.string(),
        price: db.float(),
        category: db.enum("electronics", "books", "clothing"),
        metadata: db.object({
          weight: db.float().optional(),
          dimensions: db
            .object({
              width: db.float(),
              height: db.float(),
              depth: db.float(),
            })
            .optional(),
        }),
      }),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      id: string;
      product: {
        name: string;
        price: number;
        category: "electronics" | "books" | "clothing";
        metadata: {
          weight?: number | null;
          dimensions?: {
            width: number;
            height: number;
            depth: number;
          } | null;
        };
      };
    }>();
  });
});
