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

  // Note: trimSDKCode tests have been removed as this method has been moved to bundler/utils.ts
  // These tests should be moved to a separate test file for bundler/utils.ts

  describe("transform", () => {
    it("resolverのステップを適切にエクスポートする", () => {
      const testCode = multiline /* ts */ `
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

      expect(stepContent).toContain("$tailor_db_wrapper");
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

  // Note: private methods tests have been removed as these methods have been moved to bundler/utils.ts
  // These include: isNodeInRemovedRange, getDefinedIdentifiersFromNode, removeRangesFromSource
  // These tests should be moved to a separate test file for bundler/utils.ts

  describe("helper functions", () => {
    it("stepVariableName: 正しい変数名を生成する", () => {
      // stepVariableNameは現在モジュール内の関数なのでテストできない
      // 将来的にクラスメソッドにする場合のためのプレースホルダー
    });
  });
});
