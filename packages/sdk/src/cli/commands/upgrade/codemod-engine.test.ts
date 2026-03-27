import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Lang } from "@ast-grep/napi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addImportSpecifier,
  addProperty,
  applyPatternReplace,
  batchRename,
  findIdentifiers,
  findPattern,
  getArgs,
  langForFile,
  parseTypeScript,
  removeImportSpecifier,
  removeProperty,
  renameIdentifiers,
  renameImportSpecifier,
  renamePropertyInPattern,
  transformFile,
  wrapExpression,
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

    it("should accept lang parameter for TSX", () => {
      const source = `const App = () => <Foo bar="baz" />;`;
      const matches = findPattern(source, "Foo", Lang.Tsx);
      expect(matches.length).toBeGreaterThanOrEqual(0); // TSX parsing works without error
    });
  });

  describe("getArgs", () => {
    it("should filter out comma separator nodes from variadic captures", () => {
      const source = `foo(a, b, c)`;
      const matches = findPattern(source, "foo($$$ARGS)");
      expect(matches).toHaveLength(1);
      const args = getArgs(matches[0], "ARGS");
      expect(args).toHaveLength(3);
      expect(args.map((n) => n.text())).toEqual(["a", "b", "c"]);
    });

    it("should handle single argument", () => {
      const source = `foo(a)`;
      const matches = findPattern(source, "foo($$$ARGS)");
      const args = getArgs(matches[0], "ARGS");
      expect(args).toHaveLength(1);
      expect(args[0].text()).toBe("a");
    });

    it("should handle no arguments", () => {
      const source = `foo()`;
      const matches = findPattern(source, "foo($$$ARGS)");
      const args = getArgs(matches[0], "ARGS");
      expect(args).toHaveLength(0);
    });
  });

  describe("findIdentifiers", () => {
    it("should find identifier nodes (function names)", () => {
      const source = `import { defineGenerators } from "sdk";\ndefineGenerators(plugin());`;
      const matches = findIdentifiers(source, "defineGenerators");
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("should find property_identifier nodes (object property keys)", () => {
      const source = `const config = { publishEvents: true, name: "test" };`;
      const matches = findIdentifiers(source, "publishEvents");
      expect(matches).toHaveLength(1);
      expect(matches[0].kind()).toBe("property_identifier");
    });

    it("should NOT match inside string literals", () => {
      const source = `const x = "publishEvents is deprecated";`;
      const matches = findIdentifiers(source, "publishEvents");
      expect(matches).toHaveLength(0);
    });

    it("should NOT match inside comments", () => {
      const source = `// publishEvents is deprecated\nconst x = 1;`;
      const matches = findIdentifiers(source, "publishEvents");
      expect(matches).toHaveLength(0);
    });

    it("should NOT match substring of another identifier", () => {
      const source = `const createWorkflowJob = () => {};`;
      const matches = findIdentifiers(source, "createWorkflow");
      expect(matches).toHaveLength(0);
    });

    it("should find both identifier and property_identifier in same source", () => {
      const source = `import { authInvoker } from "./config";\nconst config = { authInvoker: auth.invoker() };`;
      const matches = findIdentifiers(source, "authInvoker");
      expect(matches).toHaveLength(2);
    });
  });

  describe("renameIdentifiers", () => {
    it("should rename identifier nodes", () => {
      const source = `import { defineGenerators } from "sdk";\ndefineGenerators(plugin());`;
      const { output, count } = renameIdentifiers(source, "defineGenerators", "definePlugins");
      expect(count).toBeGreaterThanOrEqual(2);
      expect(output).toContain("definePlugins");
      expect(output).not.toContain("defineGenerators");
    });

    it("should rename property_identifier nodes", () => {
      const source = `const config = { publishEvents: true };`;
      const { output, count } = renameIdentifiers(source, "publishEvents", "emitEvents");
      expect(count).toBe(1);
      expect(output).toBe(`const config = { emitEvents: true };`);
    });

    it("should return unchanged source when no matches", () => {
      const source = `const x = 1;`;
      const { output, count } = renameIdentifiers(source, "publishEvents", "emitEvents");
      expect(count).toBe(0);
      expect(output).toBe(source);
    });

    it("should also rename occurrences in comments (replaceAll behavior)", () => {
      const source = `// Uses publishEvents for event emission\nconst config = { publishEvents: true };`;
      const { output } = renameIdentifiers(source, "publishEvents", "emitEvents");
      expect(output).toContain("// Uses emitEvents");
      expect(output).toContain("emitEvents: true");
    });
  });

  describe("batchRename", () => {
    it("should rename multiple identifiers", () => {
      const source = `import { recordCreatedTrigger, scheduleTrigger } from "sdk";\nrecordCreatedTrigger({ type: "User" });\nscheduleTrigger({ cron: "0 0 * * *" });`;
      const renames = new Map([
        ["recordCreatedTrigger", "onRecordCreated"],
        ["scheduleTrigger", "onSchedule"],
      ]);
      const { output, count } = batchRename(source, renames);
      expect(count).toBeGreaterThanOrEqual(4);
      expect(output).toContain("onRecordCreated");
      expect(output).toContain("onSchedule");
      expect(output).not.toContain("recordCreatedTrigger");
      expect(output).not.toContain("scheduleTrigger");
    });

    it("should handle substring conflicts by sorting longest-first", () => {
      const source = `import { createWorkflow, createWorkflowJob } from "sdk";\ncreateWorkflowJob({ name: "job" });\ncreateWorkflow({ mainJob: job });`;
      const renames = new Map([
        // Intentionally put shorter name first to test auto-sort
        ["createWorkflow", "defineWorkflow"],
        ["createWorkflowJob", "defineWorkflowJob"],
      ]);
      const { output } = batchRename(source, renames);
      expect(output).toContain("defineWorkflowJob");
      expect(output).toContain("defineWorkflow");
      expect(output).not.toContain("createWorkflow");
      // Verify no corruption: "defineWorkflowJob" should not become "definedefineWorkflowJob"
      expect(output).not.toContain("definedefine");
    });

    it("should return unchanged source when no matches", () => {
      const source = `const x = 1;`;
      const renames = new Map([["foo", "bar"]]);
      const { output, count } = batchRename(source, renames);
      expect(count).toBe(0);
      expect(output).toBe(source);
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

      const result = await transformFile(
        filePath,
        (source) => source.replace("const x = 1", "const x = 2"),
        false,
      );

      expect(result.changed).toBe(true);
      expect(result.before).toBeUndefined();
      expect(result.after).toBeUndefined();
      const content = await fs.promises.readFile(filePath, "utf-8");
      expect(content).toBe("const x = 2;");
    });

    it("should not write file in dry-run mode but return diff", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      const original = "const x = 1;";
      await fs.promises.writeFile(filePath, original, "utf-8");

      const result = await transformFile(
        filePath,
        (source) => source.replace("const x = 1", "const x = 2"),
        true,
      );

      expect(result.changed).toBe(true);
      expect(result.before).toBe("const x = 1;");
      expect(result.after).toBe("const x = 2;");
      const content = await fs.promises.readFile(filePath, "utf-8");
      expect(content).toBe(original);
    });

    it("should return false when transform returns null", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

      const result = await transformFile(filePath, () => null, false);
      expect(result.changed).toBe(false);
    });

    it("should return false when transform returns identical source", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

      const result = await transformFile(filePath, (source) => source, false);
      expect(result.changed).toBe(false);
    });
  });

  describe("import manipulation", () => {
    describe("renameImportSpecifier", () => {
      it("should rename a named import specifier", () => {
        const source = `import { foo } from "mod";`;
        const { output, count } = renameImportSpecifier(source, "foo", "bar");
        expect(count).toBe(1);
        expect(output).toBe(`import { bar } from "mod";`);
      });

      it("should rename only in matching module when filter is provided", () => {
        const source = `import { foo } from "mod-a";\nimport { foo } from "mod-b";`;
        const { output, count } = renameImportSpecifier(source, "foo", "bar", "mod-a");
        expect(count).toBe(1);
        expect(output).toBe(`import { bar } from "mod-a";\nimport { foo } from "mod-b";`);
      });

      it("should not rename same identifier in non-matching imports", () => {
        const source = `import { foo } from "other";`;
        const { output, count } = renameImportSpecifier(source, "foo", "bar", "mod");
        expect(count).toBe(0);
        expect(output).toBe(source);
      });

      it("should handle type imports", () => {
        const source = `import { type Foo } from "mod";`;
        const { output, count } = renameImportSpecifier(source, "Foo", "Bar");
        expect(count).toBe(1);
        expect(output).toBe(`import { type Bar } from "mod";`);
      });

      it("should return count 0 when no match", () => {
        const source = `import { baz } from "mod";`;
        const { output, count } = renameImportSpecifier(source, "foo", "bar");
        expect(count).toBe(0);
        expect(output).toBe(source);
      });

      it("should rename one of multiple specifiers", () => {
        const source = `import { foo, bar } from "mod";`;
        const { output, count } = renameImportSpecifier(source, "foo", "baz");
        expect(count).toBe(1);
        expect(output).toBe(`import { baz, bar } from "mod";`);
      });
    });

    describe("removeImportSpecifier", () => {
      it("should remove entire import when single specifier", () => {
        const source = `import { foo } from "mod";\n`;
        const { output, count } = removeImportSpecifier(source, "foo");
        expect(count).toBe(1);
        expect(output).toBe("");
      });

      it("should remove first of multiple specifiers", () => {
        const source = `import { foo, bar } from "mod";`;
        const { output, count } = removeImportSpecifier(source, "foo");
        expect(count).toBe(1);
        expect(output).toBe(`import { bar } from "mod";`);
      });

      it("should remove last of multiple specifiers", () => {
        const source = `import { foo, bar } from "mod";`;
        const { output, count } = removeImportSpecifier(source, "bar");
        expect(count).toBe(1);
        expect(output).toBe(`import { foo } from "mod";`);
      });

      it("should remove middle of three specifiers", () => {
        const source = `import { foo, bar, baz } from "mod";`;
        const { output, count } = removeImportSpecifier(source, "bar");
        expect(count).toBe(1);
        expect(output).toBe(`import { foo, baz } from "mod";`);
      });

      it("should filter by module specifier", () => {
        const source = `import { foo } from "mod-a";\nimport { foo } from "mod-b";\n`;
        const { output, count } = removeImportSpecifier(source, "foo", "mod-a");
        expect(count).toBe(1);
        expect(output).toBe(`import { foo } from "mod-b";\n`);
      });

      it("should return count 0 when no match", () => {
        const source = `import { bar } from "mod";`;
        const { output, count } = removeImportSpecifier(source, "foo");
        expect(count).toBe(0);
        expect(output).toBe(source);
      });
    });

    describe("addImportSpecifier", () => {
      it("should add to existing import", () => {
        const source = `import { foo } from "mod";`;
        const { output, count } = addImportSpecifier(source, "bar", "mod");
        expect(count).toBe(1);
        expect(output).toBe(`import { foo, bar } from "mod";`);
      });

      it("should return count 0 for duplicate", () => {
        const source = `import { foo } from "mod";`;
        const { output, count } = addImportSpecifier(source, "foo", "mod");
        expect(count).toBe(0);
        expect(output).toBe(source);
      });

      it("should create new import when module not found", () => {
        const source = `import { foo } from "other";\n`;
        const { output, count } = addImportSpecifier(source, "bar", "mod");
        expect(count).toBe(1);
        expect(output).toBe(`import { foo } from "other";\nimport { bar } from "mod";\n`);
      });

      it("should insert at top when no imports exist", () => {
        const source = `const x = 1;`;
        const { output, count } = addImportSpecifier(source, "foo", "mod");
        expect(count).toBe(1);
        expect(output).toBe(`import { foo } from "mod";\nconst x = 1;`);
      });

      it("should add after last import statement", () => {
        const source = `import { a } from "a";\nimport { b } from "b";\nconst x = 1;`;
        const { output, count } = addImportSpecifier(source, "c", "c");
        expect(count).toBe(1);
        expect(output).toBe(
          `import { a } from "a";\nimport { b } from "b";\nimport { c } from "c";\nconst x = 1;`,
        );
      });
    });
  });

  describe("renamePropertyInPattern", () => {
    it("should rename property only within pattern context", () => {
      const source = `const attributes = "global";\ndefineAuth({ attributes: { role: true } });`;
      const { output, count } = renamePropertyInPattern(
        source,
        "defineAuth($$$ARGS)",
        "attributes",
        "fields",
      );
      expect(count).toBe(1);
      expect(output).toContain('const attributes = "global"');
      expect(output).toContain("defineAuth({ fields: { role: true } })");
    });

    it("should handle multiple matches", () => {
      const source = `setup({ attributes: 1 });\nsetup({ attributes: 2 });`;
      const { output, count } = renamePropertyInPattern(
        source,
        "setup($$$ARGS)",
        "attributes",
        "fields",
      );
      expect(count).toBe(2);
      expect(output).toBe(`setup({ fields: 1 });\nsetup({ fields: 2 });`);
    });

    it("should return unchanged source when pattern matches but oldProp is absent", () => {
      const source = `defineAuth({ role: true });`;
      const { output } = renamePropertyInPattern(
        source,
        "defineAuth($$$ARGS)",
        "attributes",
        "fields",
      );
      expect(output).toBe(source);
    });

    it("should not rename outside pattern context", () => {
      const source = `const attributes = "x";\nfoo({ attributes: 1 });`;
      const { output } = renamePropertyInPattern(source, "foo($$$ARGS)", "attributes", "fields");
      expect(output).toContain('const attributes = "x"');
      expect(output).toContain("foo({ fields: 1 })");
    });

    it("should work with nested objects", () => {
      const source = `config({ outer: { attributes: "val" } });`;
      const { output, count } = renamePropertyInPattern(
        source,
        "config($$$ARGS)",
        "attributes",
        "fields",
      );
      expect(count).toBe(1);
      expect(output).toBe(`config({ outer: { fields: "val" } });`);
    });
  });

  describe("structural change helpers", () => {
    describe("removeProperty", () => {
      it("should remove a property from matched object", () => {
        const source = `setup({ alpha: 1, beta: 2 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "alpha");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ beta: 2 });`);
      });

      it("should remove the last property from matched object", () => {
        const source = `setup({ alpha: 1, beta: 2 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "beta");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ alpha: 1 });`);
      });

      it("should remove the only property", () => {
        const source = `setup({ alpha: 1 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "alpha");
        expect(count).toBe(1);
        expect(output).toBe(`setup({});`);
      });

      it("should return unchanged when property not found", () => {
        const source = `setup({ alpha: 1 });`;
        const { output } = removeProperty(source, "setup($$$ARGS)", "missing");
        expect(output).toBe(source);
      });

      it("should handle multiple pattern matches", () => {
        const source = `setup({ alpha: 1 });\nsetup({ alpha: 2 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "alpha");
        expect(count).toBe(2);
        expect(output).toBe(`setup({});\nsetup({});`);
      });

      it("should remove middle property of three", () => {
        const source = `setup({ a: 1, b: 2, c: 3 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "b");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ a: 1, c: 3 });`);
      });
    });

    describe("addProperty", () => {
      it("should add a property to matched object", () => {
        const source = `setup({ alpha: 1 });`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "beta", "2");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ alpha: 1, beta: 2 });`);
      });

      it("should not add duplicate property", () => {
        const source = `setup({ alpha: 1 });`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "alpha", "2");
        expect(count).toBe(1);
        expect(output).toBe(source);
      });

      it("should add to empty object", () => {
        const source = `setup({});`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "alpha", "1");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ alpha: 1 });`);
      });

      it("should handle multiple pattern matches", () => {
        const source = `setup({ a: 1 });\nsetup({ a: 2 });`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "b", "true");
        expect(count).toBe(2);
        expect(output).toBe(`setup({ a: 1, b: true });\nsetup({ a: 2, b: true });`);
      });
    });

    describe("wrapExpression", () => {
      it("should wrap matched expression", () => {
        const source = `const x = getValue();`;
        const { output, count } = wrapExpression(source, "getValue()", "transform($EXPR)");
        expect(count).toBe(1);
        expect(output).toBe(`const x = transform(getValue());`);
      });

      it("should handle multiple matches", () => {
        const source = `foo(1);\nfoo(2);`;
        const { output, count } = wrapExpression(source, "foo($A)", "bar($EXPR)");
        expect(count).toBe(2);
        expect(output).toBe(`bar(foo(1));\nbar(foo(2));`);
      });

      it("should preserve matched text in template", () => {
        const source = `createResolver({ name: "test" });`;
        const { output, count } = wrapExpression(
          source,
          "createResolver($$$ARGS)",
          "wrapResolver($EXPR)",
        );
        expect(count).toBe(1);
        expect(output).toBe(`wrapResolver(createResolver({ name: "test" }));`);
      });
    });
  });
});
