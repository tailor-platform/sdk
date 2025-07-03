import { describe, it, expect, expectTypeOf } from "vitest";
import { t } from "./type";
import type { output } from "./helpers";

describe("TailorType 基本フィールド型テスト", () => {
  it("string型フィールドが正しくstring型を出力する", () => {
    const _stringType = t.type({
      name: t.string(),
    });
    expectTypeOf<output<typeof _stringType>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  it("int型フィールドが正しくnumber型を出力する", () => {
    const _intType = t.type({
      age: t.int(),
    });
    expectTypeOf<output<typeof _intType>>().toEqualTypeOf<{
      age: number;
    }>();
  });

  it("bool型フィールドが正しくboolean型を出力する", () => {
    const _boolType = t.type({
      active: t.bool(),
    });
    expectTypeOf<output<typeof _boolType>>().toEqualTypeOf<{
      active: boolean;
    }>();
  });

  it("float型フィールドが正しくnumber型を出力する", () => {
    const _floatType = t.type({
      price: t.float(),
    });
    expectTypeOf<output<typeof _floatType>>().toEqualTypeOf<{
      price: number;
    }>();
  });

  it("uuid型フィールドが正しくstring型を出力する", () => {
    const _uuidType = t.type({
      id: t.uuid(),
    });
    expectTypeOf<output<typeof _uuidType>>().toEqualTypeOf<{
      id: string;
    }>();
  });
});

describe("TailorField オプショナル修飾子テスト", () => {
  it("optional()修飾子がnull許可型を生成する", () => {
    const _optionalType = t.type({
      description: t.string().optional(),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      description?: string | null;
    }>();
  });

  it("複数のオプショナルフィールドが正しく動作する", () => {
    const _multiOptionalType = t.type({
      title: t.string(),
      description: t.string().optional(),
      count: t.int().optional(),
    });
    expectTypeOf<output<typeof _multiOptionalType>>().toEqualTypeOf<{
      title: string;
      description?: string | null;
      count?: number | null;
    }>();
  });
});

describe("TailorField 配列修飾子テスト", () => {
  it("array()修飾子が配列型を生成する", () => {
    const _arrayType = t.type({
      tags: t.string().array(),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      tags: string[];
    }>();
  });

  it("オプショナル配列が正しく動作する", () => {
    const _optionalArrayType = t.type({
      items: t.string().array().optional(),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      items?: string[] | null;
    }>();
  });

  it("複数の配列フィールドが正しく動作する", () => {
    const _multiArrayType = t.type({
      tags: t.string().array(),
      numbers: t.int().array(),
      flags: t.bool().array(),
    });
    expectTypeOf<output<typeof _multiArrayType>>().toEqualTypeOf<{
      tags: string[];
      numbers: number[];
      flags: boolean[];
    }>();
  });
});

describe("TailorField enum フィールドテスト", () => {
  it("enum()でユニオン型を生成する", () => {
    const _enumType = t.type({
      status: t.enum(["active", "inactive", "pending"]),
    });
    expectTypeOf<output<typeof _enumType>>().toEqualTypeOf<{
      status: "active" | "inactive" | "pending";
    }>();
  });

  it("オプショナルenum()が正しく動作する", () => {
    const _optionalEnumType = t.type({
      priority: t.enum(["high", "medium", "low"]).optional(),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum配列が正しく動作する", () => {
    const _enumArrayType = t.type({
      categories: t.enum(["a", "b", "c"]).array(),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorField assertNonNull修飾子テスト", () => {
  it("optional({ assertNonNull: true })修飾子がメタデータを正しく設定する", () => {
    const field = t.string().optional({ assertNonNull: true });
    expect(field.metadata.assertNonNull).toBe(true);
    expect(field.metadata.required).toBe(false);
  });

  it("optional({ assertNonNull: false })修飾子がメタデータを正しく設定する", () => {
    const field = t.string().optional({ assertNonNull: false });
    expect(field.metadata.assertNonNull).toBe(undefined);
    expect(field.metadata.required).toBe(false);
  });

  it("optional()がデフォルトでassertNonNullをfalseとして扱う", () => {
    const field = t.string().optional();
    expect(field.metadata.assertNonNull).toBe(undefined);
    expect(field.metadata.required).toBe(false);
  });

  it("optional({ assertNonNull: true })修飾子が各型で動作する", () => {
    expect(
      t.string().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
    expect(
      t.int().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
    expect(
      t.bool().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
    expect(
      t.uuid().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
    expect(
      t.float().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
    expect(
      t.date().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
    expect(
      t.datetime().optional({ assertNonNull: true }).metadata.assertNonNull,
    ).toBe(true);
  });

  it("optional({ assertNonNull: true })修飾子がenum型で動作する", () => {
    const enumField = t.enum(["a", "b", "c"]).optional({ assertNonNull: true });
    expect(enumField.metadata.assertNonNull).toBe(true);
    expect(enumField.metadata.required).toBe(false);
  });

  it("optional({ assertNonNull: true })修飾子がobject型で動作する", () => {
    const objectField = t
      .object({
        name: t.string(),
      })
      .optional({ assertNonNull: true });
    expect(objectField.metadata.assertNonNull).toBe(true);
    expect(objectField.metadata.required).toBe(false);
  });
});

describe("TailorType 複合型テスト", () => {
  it("複数フィールドを持つ型が正しく動作する", () => {
    const _complexType = t.type({
      id: t.uuid(),
      name: t.string(),
      email: t.string(),
      age: t.int().optional(),
      isActive: t.bool(),
      tags: t.string().array(),
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

describe("TailorType エッジケーステスト", () => {
  it("単一フィールドの型が正しく動作する", () => {
    const _singleFieldType = t.type({
      value: t.string(),
    });
    expectTypeOf<output<typeof _singleFieldType>>().toEqualTypeOf<{
      value: string;
    }>();
  });

  it("すべてオプショナルフィールドの型が正しく動作する", () => {
    const _allOptionalType = t.type({
      a: t.string().optional(),
      b: t.int().optional(),
      c: t.bool().optional(),
    });
    expectTypeOf<output<typeof _allOptionalType>>().toEqualTypeOf<{
      a?: string | null;
      b?: number | null;
      c?: boolean | null;
    }>();
  });

  it("すべて配列フィールドの型が正しく動作する", () => {
    const _allArrayType = t.type({
      strings: t.string().array(),
      numbers: t.int().array(),
      booleans: t.bool().array(),
    });
    expectTypeOf<output<typeof _allArrayType>>().toEqualTypeOf<{
      strings: string[];
      numbers: number[];
      booleans: boolean[];
    }>();
  });
});

describe("TailorField 修飾子チェーンテスト", () => {
  it("修飾子の順序が結果に影響しない", () => {
    const _chainType1 = t.type({
      field: t.string().optional().array(),
    });
    const _chainType2 = t.type({
      field: t.string().array().optional(),
    });
    expectTypeOf<output<typeof _chainType1>>().toEqualTypeOf<
      output<typeof _chainType2>
    >();
  });
});

describe("TailorType 型の一貫性テスト", () => {
  it("同じ定義は同じ型を生成する", () => {
    const _type1 = t.type({
      name: t.string(),
      age: t.int(),
    });
    const _type2 = t.type({
      name: t.string(),
      age: t.int(),
    });
    expectTypeOf<output<typeof _type1>>().toEqualTypeOf<
      output<typeof _type2>
    >();
  });
});

describe("t.object テスト", () => {
  it("基本的なオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("オプショナルフィールドを含むオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      profile: t.object({
        name: t.string(),
        age: t.int().optional(),
        email: t.string().optional(),
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

  it("配列フィールドを含むオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      data: t.object({
        name: t.string(),
        tags: t.string().array(),
        scores: t.int().array().optional(),
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

  it("ネストしたオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      user: t.object({
        name: t.string(),
        address: t.object({
          street: t.string(),
          city: t.string(),
          zipCode: t.string().optional(),
        }),
        contacts: t
          .object({
            email: t.string(),
            phone: t.string().optional(),
          })
          .optional(),
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

  it("オプショナル修飾子を持つオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      metadata: t
        .object({
          version: t.string(),
          author: t.string(),
        })
        .optional(),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      metadata?: {
        version: string;
        author: string;
      } | null;
    }>();
  });

  it("配列修飾子を持つオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      items: t
        .object({
          id: t.uuid(),
          name: t.string(),
        })
        .array(),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      items: {
        id: string;
        name: string;
      }[];
    }>();
  });

  it("複数の修飾子を組み合わせたオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      optionalItems: t
        .object({
          id: t.uuid(),
          value: t.string().optional(),
        })
        .array()
        .optional(),
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

  it("enum型を含むオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      config: t.object({
        name: t.string(),
        status: t.enum(["active", "inactive"]),
        priority: t.enum(["high", "medium", "low"]).optional(),
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

  it("単一フィールドのオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("空オブジェクトを正しく推論する", () => {
    const _objectType = t.type({
      empty: t.object({}),
    });
    expectTypeOf<output<typeof _objectType>>().toEqualTypeOf<{
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      empty: {};
    }>();
  });
});
