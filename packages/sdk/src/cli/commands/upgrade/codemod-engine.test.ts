import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Lang } from "@ast-grep/napi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPatternReplace,
  findPattern,
  langForFile,
  parseTypeScript,
  transformFile,
} from "./codemod-engine";

describe("codemod-engine", () => {
  describe("parseTypeScript", () => {
    it("should parse valid TypeScript source", () => {
      const root = parseTypeScript('const x = 1;\nconst y = "hello";');
      expect(root.root()).toBeDefined();
      expect(root.root().kind()).toBe("program");
    });

    it("should parse TypeScript with imports", () => {
      const source = `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "test" });`;
      const root = parseTypeScript(source);
      expect(root.root().kind()).toBe("program");
    });

    it("should parse TSX source when Lang.Tsx is specified", () => {
      const source = `const App = () => <div className="test">hello</div>;`;
      const root = parseTypeScript(source, Lang.Tsx);
      expect(root.root().kind()).toBe("program");
    });
  });

  describe("langForFile", () => {
    it("should return Lang.Tsx for .tsx files", () => {
      expect(langForFile("src/App.tsx")).toBe(Lang.Tsx);
    });

    it("should return Lang.TypeScript for .ts files", () => {
      expect(langForFile("src/index.ts")).toBe(Lang.TypeScript);
    });
  });

  describe("findPattern", () => {
    it("should find simple function calls", () => {
      const source = `defineGenerators(plugin1, plugin2);`;
      const matches = findPattern(source, "defineGenerators($$$ARGS)");
      expect(matches).toHaveLength(1);
    });

    it("should find multiple matches", () => {
      const source = `console.log("a");\nconsole.log("b");\nconsole.log("c");`;
      const matches = findPattern(source, "console.log($MSG)");
      expect(matches).toHaveLength(3);
    });

    it("should return empty array when no matches", () => {
      const source = `const x = 1;`;
      const matches = findPattern(source, "defineGenerators($$$ARGS)");
      expect(matches).toHaveLength(0);
    });
  });

  describe("applyPatternReplace", () => {
    it("should replace a simple function name using node text", () => {
      const source = `defineGenerators(kyselyPlugin())`;
      const result = applyPatternReplace(source, "defineGenerators($$$ARGS)", (node) => {
        const argsText = node
          .getMultipleMatches("ARGS")
          .map((n) => n.text())
          .join(", ");
        return `definePlugins(${argsText})`;
      });
      expect(result.output).toBe("definePlugins(kyselyPlugin())");
      expect(result.count).toBe(1);
    });

    it("should handle no matches gracefully", () => {
      const source = `definePlugins(kyselyPlugin())`;
      const result = applyPatternReplace(source, "defineGenerators($$$ARGS)", (node) => {
        return `definePlugins(${node
          .getMultipleMatches("ARGS")
          .map((n) => n.text())
          .join(", ")})`;
      });
      expect(result.output).toBe(source);
      expect(result.count).toBe(0);
    });

    it("should handle multiple replacements", () => {
      const source = `foo(1);\nfoo(2);\nfoo(3);`;
      const result = applyPatternReplace(source, "foo($A)", (node) => {
        const a = node.getMatch("A")!.text();
        return `bar(${a})`;
      });
      expect(result.output).toBe("bar(1);\nbar(2);\nbar(3);");
      expect(result.count).toBe(3);
    });

    it("should handle nested matches by keeping only outermost", () => {
      const source = `wrap(wrap(1))`;
      const result = applyPatternReplace(source, "wrap($A)", (node) => {
        const a = node.getMatch("A")!.text();
        return `wrapped(${a})`;
      });
      // Only the outer match should be replaced; inner is nested and skipped
      expect(result.output).toBe("wrapped(wrap(1))");
      expect(result.count).toBe(1);
    });

    it("should preserve surrounding code", () => {
      const source = `const x = 1;\ndefineGenerators(plugin());\nconst y = 2;`;
      const result = applyPatternReplace(source, "defineGenerators($$$ARGS)", (node) => {
        const args = node
          .getMultipleMatches("ARGS")
          .map((n) => n.text())
          .join(", ");
        return `definePlugins(${args})`;
      });
      expect(result.output).toBe("const x = 1;\ndefinePlugins(plugin());\nconst y = 2;");
      expect(result.count).toBe(1);
    });
  });

  describe("transformFile", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codemod-test-"));
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it("should transform and write file when not in dry-run", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

      const changed = await transformFile(
        filePath,
        (source) => source.replace("const x = 1", "const x = 2"),
        false,
      );

      expect(changed).toBe(true);
      const result = await fs.promises.readFile(filePath, "utf-8");
      expect(result).toBe("const x = 2;");
    });

    it("should not write file in dry-run mode", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      const original = "const x = 1;";
      await fs.promises.writeFile(filePath, original, "utf-8");

      const changed = await transformFile(
        filePath,
        (source) => source.replace("const x = 1", "const x = 2"),
        true,
      );

      expect(changed).toBe(true);
      const result = await fs.promises.readFile(filePath, "utf-8");
      expect(result).toBe(original);
    });

    it("should return false when transform returns null", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

      const changed = await transformFile(filePath, () => null, false);
      expect(changed).toBe(false);
    });

    it("should return false when transform returns identical source", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

      const changed = await transformFile(filePath, (source) => source, false);
      expect(changed).toBe(false);
    });
  });
});
