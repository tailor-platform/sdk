import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, basename } from "node:path";
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

  describe("transform", () => {
    const writeResolverModule = (fileName: string, source: string) => {
      const filePath = join(tempDir, fileName);
      writeFileSync(filePath, source);
      return filePath;
    };

    it("resolverのステップを適切にエクスポートする", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          steps: [
            ["fn", "step1", () => "step1 result", {}],
            ["sql", "step2", async () => ({ id: 1 }), { dbNamespace: "test" }],
            ["gql", "step3", () => {}, {}],
          ],
          options: {
            defaults: {
              dbNamespace: "test",
            },
          },
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule("resolver.js", moduleSource);

      const resultFiles = await transformer.transform(testFile, tempDir);

      // 変換されたファイルが作成されることを確認
      const transformedFile = join(
        tempDir,
        `${basename(testFile, ".js")}.transformed.js`,
      );
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
      expect(resultFiles[0]).toContain(`${resolverName}__step1.js`);
      expect(resultFiles[1]).toContain(`${resolverName}__step2.js`);
    });

    it("SQLステップに適切なラッパーを生成する", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          steps: [
            [
              "sql",
              "sqlStep",
              async () => ({ result: "test" }),
              { dbNamespace: "mydb" },
            ],
          ],
          options: {},
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule("resolver-sql.js", moduleSource);

      const resultFiles = await transformer.transform(testFile, tempDir);

      const stepFile = resultFiles[0];
      const stepContent = readFileSync(stepFile, "utf-8");

      expect(stepContent).toContain("$tailor_db_wrapper");
      expect(stepContent).toContain('"mydb"');
      expect(stepContent).toContain("$tailor_resolver_step__sqlStep");
    });

    it("デフォルトのdbNamespaceを使用する", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          steps: [
            ["sql", "sqlStep", async () => ({ result: "test" }), {}],
          ],
          options: {
            defaults: {
              dbNamespace: "defaultDb",
            },
          },
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule(
        "resolver-default-db.js",
        moduleSource,
      );

      const resultFiles = await transformer.transform(testFile, tempDir);

      const stepFile = resultFiles[0];
      const stepContent = readFileSync(stepFile, "utf-8");

      expect(stepContent).toContain('"defaultDb"');
    });

    it("dbNamespaceが設定されていない場合はエラーを投げる", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          steps: [["sql", "sqlStep", async () => ({ result: "test" }), {}]],
          options: {},
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule(
        "resolver-missing-db.js",
        moduleSource,
      );

      await expect(transformer.transform(testFile, tempDir)).rejects.toThrow(
        `Database namespace is not defined at ${resolverName} > sqlStep`,
      );
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
