import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import multiline from "multiline-ts";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodeTransformer } from "./transformer";

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
        };

        export default resolver;
      `.trim();

      const testFile = writeResolverModule("resolver1.js", moduleSource);

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

    it("createResolverを使ったresolverを正しく変換する", async () => {
      const resolverName = "testResolver";
      const moduleSource = multiline /* ts */ `
        const createResolver = (config) => config;

        export default createResolver({
          name: "${resolverName}",
          operation: "query",
          body: async () => ({ result: "test" }),
        });
      `.trim();

      const testFile = writeResolverModule("resolver2.js", moduleSource);

      const resultFiles = await transformer.transform(testFile, tempDir);

      const transformedFile = join(
        tempDir,
        `${basename(testFile, ".js")}.transformed.js`,
      );
      expect(existsSync(transformedFile)).toBe(true);

      const transformedContent = readFileSync(transformedFile, "utf-8");

      // Should convert to _internalResolver
      expect(transformedContent).toContain("const _internalResolver");
      expect(transformedContent).toContain("export default _internalResolver");
      expect(transformedContent).toContain(
        "export const $tailor_resolver_body",
      );

      // bodyファイルが作成されることを確認
      expect(resultFiles).toHaveLength(1);
      expect(resultFiles[0]).toContain(`${resolverName}__body.js`);
    });

    it("inputにvalidateがある場合、StandardSchema Result型を使用する", async () => {
      const resolverName = "validatedResolver";
      const moduleSource = multiline /* ts */ `
        const createResolver = (config) => config;

        export default createResolver({
          name: "${resolverName}",
          operation: "mutation",
          input: {
            email: {
              type: "string",
              metadata: {
                required: true,
                validate: [(args) => args.value.includes("@"), "Must be valid email"],
              },
              fields: {},
            },
          },
          body: async (context) => ({ result: "validated" }),
        });
      `.trim();

      const testFile = writeResolverModule("resolver3.js", moduleSource);

      const resultFiles = await transformer.transform(testFile, tempDir);

      const transformedFile = join(
        tempDir,
        `${basename(testFile, ".js")}.transformed.js`,
      );
      expect(existsSync(transformedFile)).toBe(true);

      const transformedContent = readFileSync(transformedFile, "utf-8");

      // Should use t.object().parse and handle Result type
      expect(transformedContent).toContain("t.object");
      expect(transformedContent).toContain(".parse");
      expect(transformedContent).toContain("_internalResolver.input");
      expect(transformedContent).toContain("const result =");
      expect(transformedContent).toContain("result.issues");
      expect(transformedContent).toContain("throw new Error");

      expect(resultFiles).toHaveLength(1);
      expect(resultFiles[0]).toContain(`${resolverName}__body.js`);
    });
  });
});
