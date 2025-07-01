import { describe, it, expectTypeOf } from "vitest";
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
