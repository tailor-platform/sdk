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

    it("resolverのbodyを適切にエクスポートする", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          body: async () => ({ result: "test" }),
          options: { dbNamespace: "test" },
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule("resolver.js", moduleSource);

      const resultFiles = await transformer.transform(testFile, tempDir);

      // Verify that the transformed file is created
      const transformedFile = join(
        tempDir,
        `${basename(testFile, ".js")}.transformed.js`,
      );
      expect(existsSync(transformedFile)).toBe(true);

      const transformedContent = readFileSync(transformedFile, "utf-8");
      expect(transformedContent).toContain(
        "export const $tailor_resolver_body",
      );

      // bodyファイルが作成されることを確認
      expect(resultFiles).toHaveLength(1);
      expect(resultFiles[0]).toContain(`${resolverName}__body.js`);
    });

    it("SQL bodyに適切なラッパーを生成する", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          body: async () => ({ result: "test" }),
          options: { dbNamespace: "mydb" },
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule("resolver-sql.js", moduleSource);

      const resultFiles = await transformer.transform(testFile, tempDir);

      const bodyFile = resultFiles[0];
      const bodyContent = readFileSync(bodyFile, "utf-8");

      expect(bodyContent).toContain("$tailor_db_wrapper");
      expect(bodyContent).toContain('"mydb"');
      expect(bodyContent).toContain("$tailor_resolver_body");
    });

    it("デフォルトのdbNamespaceを使用する", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const resolver = {
          name: "${resolverName}",
          body: async () => ({ result: "test" }),
          options: { dbNamespace: "defaultDb" },
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule(
        "resolver-default-db.js",
        moduleSource,
      );

      const resultFiles = await transformer.transform(testFile, tempDir);

      const bodyFile = resultFiles[0];
      const bodyContent = readFileSync(bodyFile, "utf-8");

      expect(bodyContent).toContain('"defaultDb"');
    });
  });
});
