import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { CodeTransformer } from "./transformer";
import multiline from "multiline-ts";

describe("CodeTransformer", () => {
  let transformer: CodeTransformer;
  let tempDir: string;

  beforeEach(() => {
    transformer = new CodeTransformer();
    tempDir = join(process.cwd(), "test-temp");
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  describe("trimSDKCode", () => {
    it("@tailor-platform/tailor-sdkからのインポートを削除する", () => {
      const testCode = multiline/* ts */ `
        import { createQueryResolver } from "@tailor-platform/tailor-sdk";
        import { format } from "date-fns";
        import { someOtherLib } from "other-lib";

        const test = "hello";
        export default createQueryResolver("test");
      `.trim();

      const testFile = join(tempDir, "test.js");
      writeFileSync(testFile, testCode);

      const result = (transformer as any).trimSDKCode(testFile);

      expect(result).not.toContain("@tailor-platform/tailor-sdk");
      expect(result).toContain("date-fns");
      expect(result).toContain("other-lib");
      expect(result).not.toContain("export default");
    });

    it("SDKの識別子を使用している文を削除する", () => {
      const testCode = multiline/* ts */ `
        import { createQueryResolver, InputType } from "@tailor-platform/tailor-sdk";
        import { format } from "date-fns";

        const resolver = createQueryResolver("test");
        const other = format(new Date(), "yyyy-MM-dd");
        const input = new InputType();
      `.trim();

      const testFile = join(tempDir, "test.js");
      writeFileSync(testFile, testCode);

      const result = (transformer as any).trimSDKCode(testFile);

      expect(result).not.toContain("createQueryResolver");
      expect(result).not.toContain("InputType");
      expect(result).not.toContain("const resolver");
      expect(result).not.toContain("const input");
      expect(result).toContain("const other = format");
    });

    it("ネストした識別子の依存関係を正しく追跡する", () => {
      const testCode = multiline/* ts */ `
        import { createQueryResolver } from "@tailor-platform/tailor-sdk";

        const resolver = createQueryResolver("test");
        const step1 = resolver.fnStep("step1", () => {});
        const step2 = step1.fnStep("step2", () => {});
        const final = step2.returns(() => {});
      `.trim();

      const testFile = join(tempDir, "test.js");
      writeFileSync(testFile, testCode);

      const result = (transformer as any).trimSDKCode(testFile);

      expect(result).not.toContain("createQueryResolver");
      expect(result).not.toContain("const resolver");
      expect(result).not.toContain("const step1");
      expect(result).not.toContain("const step2");
      expect(result).not.toContain("const final");
    });

    it("SDKと関係ない識別子は保持する", () => {
      const testCode = multiline/* ts */ `
        import { createQueryResolver } from "@tailor-platform/tailor-sdk";
        import { format } from "date-fns";

        const resolver = createQueryResolver("test");
        const independentVar = "hello world";
        const anotherVar = format(new Date(), "yyyy-MM-dd");

        function independentFunction() {
          return "independent";
        }

        export const exportedFunction = () => {
          return independentVar + anotherVar;
        };
      `.trim();

      const testFile = join(tempDir, "test.js");
      writeFileSync(testFile, testCode);

      const result = (transformer as any).trimSDKCode(testFile);

      expect(result).toContain("const independentVar");
      expect(result).toContain("const anotherVar");
      expect(result).toContain("function independentFunction");
      expect(result).toContain("export const exportedFunction");
      expect(result).not.toContain("const resolver");
    });

    it("パースエラーの場合は元のコードを返す", () => {
      const invalidCode = multiline/* ts */ `
        import { createQueryResolver } from "@tailor-platform/tailor-sdk";
        const broken syntax !!!
      `.trim();

      const testFile = join(tempDir, "invalid.js");
      writeFileSync(testFile, invalidCode);

      const result = (transformer as any).trimSDKCode(testFile);

      expect(result).toBe(invalidCode);
    });

    it("空行を適切に整理する", () => {
      const testCode = multiline/* ts */ `
        import { createQueryResolver } from "@tailor-platform/tailor-sdk";


        import { format } from "date-fns";



        const other = format(new Date(), "yyyy-MM-dd");


      `.trim();

      const testFile = join(tempDir, "test.js");
      writeFileSync(testFile, testCode);

      const result = (transformer as any).trimSDKCode(testFile);

      // 3つ以上の連続する空行が2つに縮約されることを確認
      expect(result).not.toMatch(/\n\s*\n\s*\n\s*\n/);
      expect(result).toContain("import { format }");
      expect(result).toContain("const other");
    });
  });

  describe("transform", () => {
    it("resolverのステップを適切にエクスポートする", () => {
      const testCode = multiline/* ts */ `
        import { format } from "date-fns";

        const getDB = () => ({ query: () => {} });
      `.trim();

      const testFile = join(tempDir, "resolver.js");
      writeFileSync(testFile, testCode);

      // モックResolverインスタンスを作成
      const mockResolver = {
        name: "testResolver",
        steps: [
          ["fn", "step1", () => "step1 result", {}],
          ["sql", "step2", async () => ({ id: 1 }), { dbNamespace: "test" }],
          ["gql", "step3", () => {}, {}], // gqlステップは無視される
        ],
        options: {
          defaults: {
            dbNamespace: "test",
          },
        },
      } as any;

      const resultFiles = transformer.transform(
        testFile,
        mockResolver,
        tempDir,
      );

      // 変換されたファイルが作成されることを確認
      const transformedFile = join(tempDir, "resolver.transformed.js");
      expect(existsSync(transformedFile)).toBe(true);

      const transformedContent = readFileSync(transformedFile, "utf-8");
      expect(transformedContent).toContain(
        "export const $tailor_resolver_step__step1",
      );
      expect(transformedContent).toContain(
        "export const $tailor_resolver_step__step2",
      );
      expect(transformedContent).not.toContain("$tailor_resolver_step__step3"); // gqlは除外

      // ステップファイルが作成されることを確認
      expect(resultFiles).toHaveLength(2); // fn + sql の2つ
      expect(resultFiles[0]).toContain("testResolver__step1.js");
      expect(resultFiles[1]).toContain("testResolver__step2.js");
    });

    it("SQLステップに適切なラッパーを生成する", () => {
      const testCode = /* ts */ `const test = "hello";`;
      const testFile = join(tempDir, "resolver.js");
      writeFileSync(testFile, testCode);

      const mockResolver = {
        name: "testResolver",
        steps: [
          [
            "sql",
            "sqlStep",
            async () => ({ result: "test" }),
            { dbNamespace: "mydb" },
          ],
        ],
        options: {},
      } as any;

      const resultFiles = transformer.transform(
        testFile,
        mockResolver,
        tempDir,
      );

      const stepFile = resultFiles[0];
      const stepContent = readFileSync(stepFile, "utf-8");

      expect(stepContent).toContain("$tailor_sql_step_wrapper");
      expect(stepContent).toContain('"mydb"');
      expect(stepContent).toContain("$tailor_resolver_step__sqlStep");
    });

    it("デフォルトのdbNamespaceを使用する", () => {
      const testCode = /* ts */ `const test = "hello";`;
      const testFile = join(tempDir, "resolver.js");
      writeFileSync(testFile, testCode);

      const mockResolver = {
        name: "testResolver",
        steps: [
          ["sql", "sqlStep", async () => ({ result: "test" }), {}], // dbNamespaceなし
        ],
        options: {
          defaults: {
            dbNamespace: "defaultDb",
          },
        },
      } as any;

      const resultFiles = transformer.transform(
        testFile,
        mockResolver,
        tempDir,
      );

      const stepFile = resultFiles[0];
      const stepContent = readFileSync(stepFile, "utf-8");

      expect(stepContent).toContain('"defaultDb"');
    });

    it("dbNamespaceが設定されていない場合はエラーを投げる", () => {
      const testCode = /* ts */ `const test = "hello";`;
      const testFile = join(tempDir, "resolver.js");
      writeFileSync(testFile, testCode);

      const mockResolver = {
        name: "testResolver",
        steps: [["sql", "sqlStep", async () => ({ result: "test" }), {}]],
        options: {},
      } as any;

      expect(() => {
        transformer.transform(testFile, mockResolver, tempDir);
      }).toThrow("Database namespace is not defined");
    });
  });

  describe("private methods", () => {
    it("isNodeInRemovedRange: 削除範囲内のノードを正しく判定する", () => {
      const removedRanges = new Set(["10-20", "50-60"]);

      const nodeInRange = { start: 15, end: 18 } as any;
      const nodeOutOfRange = { start: 25, end: 30 } as any;
      const nodeOverlapping = { start: 18, end: 25 } as any;

      expect(
        (transformer as any).isNodeInRemovedRange(nodeInRange, removedRanges),
      ).toBe(true);
      expect(
        (transformer as any).isNodeInRemovedRange(
          nodeOutOfRange,
          removedRanges,
        ),
      ).toBe(false);
      expect(
        (transformer as any).isNodeInRemovedRange(
          nodeOverlapping,
          removedRanges,
        ),
      ).toBe(false);
    });

    it("getDefinedIdentifiersFromNode: 各種宣言から識別子を抽出する", () => {
      const varDecl = {
        type: "VariableDeclaration",
        declarations: [{ id: { type: "Identifier", name: "myVar" } }],
      } as any;

      const funcDecl = {
        type: "FunctionDeclaration",
        id: { name: "myFunction" },
      } as any;

      const classDecl = {
        type: "ClassDeclaration",
        id: { name: "MyClass" },
      } as any;

      expect(
        (transformer as any).getDefinedIdentifiersFromNode(varDecl),
      ).toEqual(["myVar"]);
      expect(
        (transformer as any).getDefinedIdentifiersFromNode(funcDecl),
      ).toEqual(["myFunction"]);
      expect(
        (transformer as any).getDefinedIdentifiersFromNode(classDecl),
      ).toEqual(["MyClass"]);
    });

    it("removeRangesFromSource: 範囲を正しく削除して結合する", () => {
      const sourceText = "0123456789ABCDEFGHIJ";
      const removedRanges = new Set(["2-4", "8-12", "16-18"]);

      const result = (transformer as any).removeRangesFromSource(
        sourceText,
        removedRanges,
      );

      // "01" + "4567" + "CDEF" + "IJ" = "014567CDEFIJ"
      expect(result).toBe("014567CDEFIJ");
    });

    it("removeRangesFromSource: 重複する範囲をマージする", () => {
      const sourceText = "0123456789";
      const removedRanges = new Set(["2-5", "4-7", "8-9"]);

      const result = (transformer as any).removeRangesFromSource(
        sourceText,
        removedRanges,
      );

      // 範囲 "2-5", "4-7" はマージされて "2-7" になる
      // 範囲 "8-9" は独立
      // "0123456789" から インデックス2-6と8を削除すると "01" + "7" + "9" = "0179"
      expect(result).toBe("0179");
    });

    it("removeRangesFromSource: 空のセットの場合は元のテキストを返す", () => {
      const sourceText = "0123456789";
      const removedRanges = new Set<string>();

      const result = (transformer as any).removeRangesFromSource(
        sourceText,
        removedRanges,
      );

      expect(result).toBe(sourceText);
    });
  });

  describe("helper functions", () => {
    it("stepVariableName: 正しい変数名を生成する", () => {
      // stepVariableNameは現在モジュール内の関数なのでテストできない
      // 将来的にクラスメソッドにする場合のためのプレースホルダー
    });
  });
});
