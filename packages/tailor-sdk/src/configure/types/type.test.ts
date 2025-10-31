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

  it("date型フィールドが正しくstring型を出力する", () => {
    const _dateType = t.type({
      birthDate: t.date(),
    });
    expectTypeOf<output<typeof _dateType>>().toEqualTypeOf<{
      birthDate: string;
    }>();
  });

  it("datetime型フィールドが正しくstring型を出力する", () => {
    const _datetimeType = t.type({
      createdAt: t.datetime(),
    });
    expectTypeOf<output<typeof _datetimeType>>().toEqualTypeOf<{
      createdAt: string;
    }>();
  });

  it("time型フィールドが正しくstring型を出力する", () => {
    const _timeType = t.type({
      openingTime: t.time(),
    });
    expectTypeOf<output<typeof _timeType>>().toEqualTypeOf<{
      openingTime: string;
    }>();
  });
});

describe("TailorField optionalオプションテスト", () => {
  it("optionalオプションがnull許可型を生成する", () => {
    const _optionalType = t.type({
      description: t.string({ optional: true }),
    });
    expectTypeOf<output<typeof _optionalType>>().toEqualTypeOf<{
      description?: string | null;
    }>();
  });

  it("複数のオプショナルフィールドが正しく動作する", () => {
    const _multiOptionalType = t.type({
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

describe("TailorField arrayオプションテスト", () => {
  it("arrayオプションが配列型を生成する", () => {
    const _arrayType = t.type({
      tags: t.string({ array: true }),
    });
    expectTypeOf<output<typeof _arrayType>>().toEqualTypeOf<{
      tags: string[];
    }>();
  });

  it("オプショナル配列が正しく動作する", () => {
    const _optionalArrayType = t.type({
      items: t.string({ optional: true, array: true }),
    });
    expectTypeOf<output<typeof _optionalArrayType>>().toEqualTypeOf<{
      items?: string[] | null;
    }>();
  });

  it("複数の配列フィールドが正しく動作する", () => {
    const _multiArrayType = t.type({
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

describe("TailorField enum フィールドテスト", () => {
  it("stringを渡してenumフィールドを設定する", () => {
    const enumField = t.enum("active", "inactive", "pending");
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
    const enumField = t.enum(
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
    const enumField = t.enum(
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
    t.enum();
    // @ts-expect-error AllowedValues requires at least one value
    t.enum({ optional: true });
  });

  it("オプショナルenum()が正しく動作する", () => {
    const _optionalEnumType = t.type({
      priority: t.enum("high", "medium", "low", { optional: true }),
    });
    expectTypeOf<output<typeof _optionalEnumType>>().toEqualTypeOf<{
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum配列が正しく動作する", () => {
    const _enumArrayType = t.type({
      categories: t.enum("a", "b", "c", { array: true }),
    });
    expectTypeOf<output<typeof _enumArrayType>>().toEqualTypeOf<{
      categories: ("a" | "b" | "c")[];
    }>();
  });
});

describe("TailorType 複合型テスト", () => {
  it("複数フィールドを持つ型が正しく動作する", () => {
    const _complexType = t.type({
      id: t.uuid(),
      name: t.string(),
      email: t.string(),
      age: t.int({ optional: true }),
      isActive: t.bool(),
      tags: t.string({ array: true }),
      role: t.enum("admin", "user", "guest"),
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

  it("すべて配列フィールドの型が正しく動作する", () => {
    const _allArrayType = t.type({
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

  it("配列フィールドを含むオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("ネストしたオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("optionalオプションを持つオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("arrayオプションを持つオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("複数の修飾子を組み合わせたオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
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

  it("enum型を含むオブジェクト型を正しく推論する", () => {
    const _objectType = t.type({
      config: t.object({
        name: t.string(),
        status: t.enum("active", "inactive"),
        priority: t.enum("high", "medium", "low", { optional: true }),
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
