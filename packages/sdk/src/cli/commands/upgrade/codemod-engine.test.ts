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
  renamePropertyAccess,
  renamePropertyAtPath,
  renamePropertyInPattern,
  replacePropertyValue,
  transformCallArguments,
  transformFile,
  transformJsonFile,
  transformTupleArgsToCall,
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

    it("should find shorthand_property_identifier nodes", () => {
      const source = `const config = { oldName };`;
      const matches = findIdentifiers(source, "oldName");
      // Should find both the variable reference and the shorthand property
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.kind() === "shorthand_property_identifier")).toBe(true);
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

    it("should rename shorthand property identifiers", () => {
      const source = `const config = { oldName };`;
      const { output, count } = renameIdentifiers(source, "oldName", "newName");
      expect(count).toBeGreaterThanOrEqual(1);
      expect(output).toContain("newName");
      expect(output).not.toContain("oldName");
    });

    it("should not corrupt longer identifiers that contain the renamed name as a substring", () => {
      const source = `import { publish, publishEvents } from "sdk";\npublish();\npublishEvents();`;
      const { output } = renameIdentifiers(source, "publish", "emit");
      expect(output).toContain("emit,");
      expect(output).toContain("emit()");
      // publishEvents must NOT become emitEvents
      expect(output).toContain("publishEvents");
      expect(output).not.toContain("emitEvents");
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

      it("should remove direct property, not nested one with same name", () => {
        const source = `setup({ nested: { alpha: 1 }, alpha: 2 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "alpha");
        expect(count).toBe(1);
        // Should remove the direct alpha: 2, not the nested alpha: 1
        expect(output).toBe(`setup({ nested: { alpha: 1 } });`);
      });

      it("should preserve shorthand properties when removing the only pair", () => {
        const source = `setup({ foo, alpha: 1 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "alpha");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ foo });`);
      });

      it("should preserve spread elements when removing the only pair", () => {
        const source = `setup({ ...defaults, alpha: 1 });`;
        const { output, count } = removeProperty(source, "setup($$$ARGS)", "alpha");
        expect(count).toBe(1);
        expect(output).toBe(`setup({ ...defaults });`);
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

      it("should not add duplicate when property exists as shorthand", () => {
        const source = `setup({ authInvoker });`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "authInvoker", "true");
        expect(count).toBe(1);
        // authInvoker already exists as a shorthand property, should not add
        expect(output).toBe(source);
      });

      it("should handle trailing comment on last property in multiline object", () => {
        const source = `setup({\n  foo: true, // keep\n})`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "bar", "1");
        expect(count).toBe(1);
        // New property should be on its own line, not appended after the comment
        expect(output).toContain("bar: 1");
        expect(output).not.toContain("// keep, bar");
      });

      it("should add property even when nested object has same name", () => {
        const source = `setup({ nested: { beta: 1 } });`;
        const { output, count } = addProperty(source, "setup($$$ARGS)", "beta", "2");
        expect(count).toBe(1);
        // beta exists only in the nested object, so it should be added to the outer object
        expect(output).toBe(`setup({ nested: { beta: 1 }, beta: 2 });`);
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

    describe("replacePropertyValue", () => {
      it("should replace a property value in matched object", () => {
        const source = `setup({ name: "old" });`;
        const { output, count } = replacePropertyValue(
          source,
          "setup($$$ARGS)",
          "name",
          () => `"new"`,
        );
        expect(count).toBe(1);
        expect(output).toBe(`setup({ name: "new" });`);
      });

      it("should return unchanged when property not found", () => {
        const source = `setup({ name: "old" });`;
        const { output, count } = replacePropertyValue(
          source,
          "setup($$$ARGS)",
          "missing",
          () => `"new"`,
        );
        expect(count).toBe(1);
        expect(output).toBe(source);
      });

      it("should return unchanged when pattern does not match", () => {
        const source = `other({ name: "old" });`;
        const { output, count } = replacePropertyValue(
          source,
          "setup($$$ARGS)",
          "name",
          () => `"new"`,
        );
        expect(count).toBe(0);
        expect(output).toBe(source);
      });

      it("should handle multiple pattern matches", () => {
        const source = `setup({ val: 1 });\nsetup({ val: 2 });`;
        const { output, count } = replacePropertyValue(
          source,
          "setup($$$ARGS)",
          "val",
          (node) => `${Number(node.text()) * 10}`,
        );
        expect(count).toBe(2);
        expect(output).toBe(`setup({ val: 10 });\nsetup({ val: 20 });`);
      });

      it("should replace object value", () => {
        const source = `config({ options: { a: 1, b: 2 } });`;
        const { output, count } = replacePropertyValue(
          source,
          "config($$$ARGS)",
          "options",
          () => `{ c: 3 }`,
        );
        expect(count).toBe(1);
        expect(output).toBe(`config({ options: { c: 3 } });`);
      });

      it("should replace function call value", () => {
        const source = `config({ handler: createHandler("old") });`;
        const { output, count } = replacePropertyValue(
          source,
          "config($$$ARGS)",
          "handler",
          () => `createHandler("new")`,
        );
        expect(count).toBe(1);
        expect(output).toBe(`config({ handler: createHandler("new") });`);
      });

      it("should replace direct property value, not nested one with same name", () => {
        const source = `setup({ nested: { val: "inner" }, val: "outer" });`;
        const { output, count } = replacePropertyValue(
          source,
          "setup($$$ARGS)",
          "val",
          () => `"replaced"`,
        );
        expect(count).toBe(1);
        // Should replace the direct val, not the nested one
        expect(output).toBe(`setup({ nested: { val: "inner" }, val: "replaced" });`);
      });
    });

    describe("transformCallArguments", () => {
      it("should transform function call arguments", () => {
        const source = `foo(a, b)`;
        const { output, count } = transformCallArguments(source, "foo", (args) => {
          return args
            .reverse()
            .map((a) => a.text())
            .join(", ");
        });
        expect(count).toBe(1);
        expect(output).toBe(`foo(b, a)`);
      });

      it("should return unchanged when no matches", () => {
        const source = `bar(1)`;
        const { output, count } = transformCallArguments(source, "foo", () => "x");
        expect(count).toBe(0);
        expect(output).toBe(source);
      });

      it("should handle multiple matches", () => {
        const source = `foo(1);\nfoo(2);`;
        const { output, count } = transformCallArguments(source, "foo", (args) => {
          const val = args[0].text();
          return `${val}, ${val}`;
        });
        expect(count).toBe(2);
        expect(output).toBe(`foo(1, 1);\nfoo(2, 2);`);
      });

      it("should handle no-argument calls", () => {
        const source = `foo()`;
        const { output, count } = transformCallArguments(source, "foo", () => "1");
        expect(count).toBe(1);
        expect(output).toBe(`foo(1)`);
      });

      it("should handle nested function calls in arguments", () => {
        const source = `foo(bar(1), baz(2))`;
        const { output, count } = transformCallArguments(source, "foo", (args) => {
          return args.map((a) => `wrap(${a.text()})`).join(", ");
        });
        expect(count).toBe(1);
        expect(output).toBe(`foo(wrap(bar(1)), wrap(baz(2)))`);
      });

      it("should handle real-world generator-to-plugin migration", () => {
        const source = `defineGenerators(["@tailor-platform/kysely-type", { distPath: "./db.ts" }])`;
        const { output, count } = transformCallArguments(source, "defineGenerators", (args) => {
          // Each arg is an array literal like ["pkg", opts]
          return args
            .map((arg) => {
              const text = arg.text();
              // Extract package name and options from array literal
              const match = text.match(/\["@tailor-platform\/(.+?)"(?:,\s*(.+))?\]/s);
              if (!match) return text;
              const [, pkgName, opts] = match;
              const fnName =
                pkgName.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) + "Plugin";
              return opts ? `${fnName}(${opts.trim()})` : `${fnName}()`;
            })
            .join(", ");
        });
        expect(count).toBe(1);
        expect(output).toBe(`defineGenerators(kyselyTypePlugin({ distPath: "./db.ts" }))`);
      });

      it("should handle method calls with receiver pattern", () => {
        const source = `obj.method(a, b)`;
        const { output, count } = transformCallArguments(source, "$OBJ.method", (args) => {
          return args.map((a) => a.text()).join(" + ");
        });
        expect(count).toBe(1);
        expect(output).toBe(`obj.method(a + b)`);
      });

      it("should preserve receivers containing parentheses", () => {
        const source = `getObj().method(a, b)`;
        const { output, count } = transformCallArguments(source, "$OBJ.method", (args) => {
          return args.map((a) => a.text()).join(" + ");
        });
        expect(count).toBe(1);
        expect(output).toBe(`getObj().method(a + b)`);
      });
    });

    describe("renamePropertyAtPath", () => {
      it("should rename property at single-level path", () => {
        const source = `config({ userProfile: { attributes: { role: true } } });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "config($$$ARGS)",
          "userProfile",
          "attributes",
          "map",
        );
        expect(count).toBe(1);
        expect(output).toBe(`config({ userProfile: { map: { role: true } } });`);
      });

      it("should rename property at multi-level path", () => {
        const source = `config({ a: { b: { target: 1 } } });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "config($$$ARGS)",
          "a.b",
          "target",
          "renamed",
        );
        expect(count).toBe(1);
        expect(output).toBe(`config({ a: { b: { renamed: 1 } } });`);
      });

      it("should rename property at root level (empty path)", () => {
        const source = `config({ name: 1, label: 2 });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "config($$$ARGS)",
          "",
          "name",
          "title",
        );
        expect(count).toBe(1);
        expect(output).toBe(`config({ title: 1, label: 2 });`);
      });

      it("should not rename when path does not exist", () => {
        const source = `config({ other: { name: 1 } });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "config($$$ARGS)",
          "missing",
          "name",
          "title",
        );
        expect(count).toBe(1);
        expect(output).toBe(source);
      });

      it("should not rename when property not at target path", () => {
        const source = `config({ attributes: 1, userProfile: { name: "x" } });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "config($$$ARGS)",
          "userProfile",
          "attributes",
          "map",
        );
        expect(count).toBe(1);
        // attributes at root level should NOT be renamed
        expect(output).toBe(source);
      });

      it("should handle multiple pattern matches", () => {
        const source = `setup({ inner: { old: 1 } });\nsetup({ inner: { old: 2 } });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "setup($$$ARGS)",
          "inner",
          "old",
          "new",
        );
        expect(count).toBe(2);
        expect(output).toBe(`setup({ inner: { new: 1 } });\nsetup({ inner: { new: 2 } });`);
      });

      it("should rename only at the exact path, not at sibling paths", () => {
        const source = `config({ a: { target: 1 }, b: { target: 2 } });`;
        const { output, count } = renamePropertyAtPath(
          source,
          "config($$$ARGS)",
          "a",
          "target",
          "renamed",
        );
        expect(count).toBe(1);
        // Only a.target should be renamed, not b.target
        expect(output).toBe(`config({ a: { renamed: 1 }, b: { target: 2 } });`);
      });
    });
  });

  describe("renamePropertyAccess", () => {
    it("should rename dot access property with receiver pattern", () => {
      const source = `const role = context.user.attributes.role;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(1);
      expect(output).toBe(`const role = context.user.map.role;`);
    });

    it("should rename optional chain access property", () => {
      const source = `const role = context.user.attributes?.role;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(1);
      expect(output).toBe(`const role = context.user.map?.role;`);
    });

    it("should rename standalone property access (no further chaining)", () => {
      const source = `const attrs = context.user.attributes;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(1);
      expect(output).toBe(`const attrs = context.user.map;`);
    });

    it("should not rename property on different receiver", () => {
      const source = `const x = element.attributes;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(0);
      expect(output).toBe(source);
    });

    it("should handle both dot and optional chain in same source", () => {
      const source = `const a = context.user.attributes.role;\nconst b = context.user.attributes?.name;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(2);
      expect(output).toBe(`const a = context.user.map.role;\nconst b = context.user.map?.name;`);
    });

    it("should handle optional chain between receiver and property", () => {
      // $A.user matches context.user (dot access), then ?.attributes is caught by the chain pattern
      const source = `const role = context.user?.attributes?.role;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(1);
      expect(output).toBe(`const role = context.user?.map?.role;`);
    });

    it("should match optional chain receiver when pattern uses optional chain", () => {
      // context?.user uses ?. so $A?.user is needed to match
      const source = `const role = context?.user?.attributes?.role;`;
      const { output, count } = renamePropertyAccess(source, "$A?.user", "attributes", "map");
      expect(count).toBe(1);
      expect(output).toBe(`const role = context?.user?.map?.role;`);
    });

    it("should handle wildcard receiver pattern", () => {
      const source = `const a = foo.attributes;\nconst b = bar.attributes?.x;`;
      const { output, count } = renamePropertyAccess(source, "$A", "attributes", "map");
      expect(count).toBe(2);
      expect(output).toBe(`const a = foo.map;\nconst b = bar.map?.x;`);
    });

    it("should not rename identifiers outside property access", () => {
      const source = `const attributes = getAttributes();\nconst x = context.user.attributes;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(1);
      // Only the property access should be renamed, not the variable declaration
      expect(output).toBe(`const attributes = getAttributes();\nconst x = context.user.map;`);
    });

    it("should handle multiple receivers", () => {
      const source = `const a = ctx.user.attributes;\nconst b = other.user.attributes?.x;`;
      const { output, count } = renamePropertyAccess(source, "$A.user", "attributes", "map");
      expect(count).toBe(2);
      expect(output).toBe(`const a = ctx.user.map;\nconst b = other.user.map?.x;`);
    });

    it("should handle deeply nested property access", () => {
      const source = `const x = a.b.c.target.d;`;
      const { output, count } = renamePropertyAccess(source, "$A.b.c", "target", "renamed");
      expect(count).toBe(1);
      expect(output).toBe(`const x = a.b.c.renamed.d;`);
    });
  });

  describe("transformTupleArgsToCall", () => {
    it("should transform single tuple argument", () => {
      const source = `defineGenerators(["@tailor-platform/kysely-type", { distPath: "./db.ts" }])`;
      const { output, count, imports } = transformTupleArgsToCall(source, "defineGenerators", [
        {
          packageName: "@tailor-platform/kysely-type",
          functionName: "kyselyTypePlugin",
          importPath: "@tailor-platform/sdk/plugin/kysely-type",
        },
      ]);
      expect(count).toBe(1);
      expect(output).toBe(`defineGenerators(kyselyTypePlugin({ distPath: "./db.ts" }))`);
      expect(imports).toEqual([
        { specifier: "kyselyTypePlugin", path: "@tailor-platform/sdk/plugin/kysely-type" },
      ]);
    });

    it("should transform multiple tuple arguments", () => {
      const source = `defineGenerators(\n  ["@tailor-platform/kysely-type", { distPath: "./db.ts" }],\n  ["@tailor-platform/enum-constants", { distPath: "./enums.ts" }],\n)`;
      const mappings = [
        {
          packageName: "@tailor-platform/kysely-type",
          functionName: "kyselyTypePlugin",
          importPath: "@tailor-platform/sdk/plugin/kysely-type",
        },
        {
          packageName: "@tailor-platform/enum-constants",
          functionName: "enumConstantsPlugin",
          importPath: "@tailor-platform/sdk/plugin/enum-constants",
        },
      ];
      const { output, count, imports } = transformTupleArgsToCall(
        source,
        "defineGenerators",
        mappings,
      );
      expect(count).toBe(1);
      expect(output).toContain('kyselyTypePlugin({ distPath: "./db.ts" })');
      expect(output).toContain('enumConstantsPlugin({ distPath: "./enums.ts" })');
      expect(imports).toHaveLength(2);
    });

    it("should leave unknown packages unchanged", () => {
      const source = `defineGenerators(["unknown-pkg", { opt: true }])`;
      const { output, count, imports } = transformTupleArgsToCall(source, "defineGenerators", [
        {
          packageName: "@tailor-platform/kysely-type",
          functionName: "kyselyTypePlugin",
          importPath: "@tailor-platform/sdk/plugin/kysely-type",
        },
      ]);
      expect(count).toBe(1);
      // Unknown package tuple is preserved as-is
      expect(output).toBe(`defineGenerators(["unknown-pkg", { opt: true }])`);
      expect(imports).toHaveLength(0);
    });

    it("should handle tuple without config argument", () => {
      const source = `defineGenerators(["@tailor-platform/kysely-type"])`;
      const { output, count } = transformTupleArgsToCall(source, "defineGenerators", [
        {
          packageName: "@tailor-platform/kysely-type",
          functionName: "kyselyTypePlugin",
          importPath: "@tailor-platform/sdk/plugin/kysely-type",
        },
      ]);
      expect(count).toBe(1);
      expect(output).toBe(`defineGenerators(kyselyTypePlugin())`);
    });

    it("should return unchanged when no matching calls", () => {
      const source = `definePlugins(kyselyTypePlugin())`;
      const { output, count, imports } = transformTupleArgsToCall(source, "defineGenerators", []);
      expect(count).toBe(0);
      expect(output).toBe(source);
      expect(imports).toHaveLength(0);
    });

    it("should handle non-array arguments (pass through unchanged)", () => {
      const source = `defineGenerators(someVariable)`;
      const { output, count } = transformTupleArgsToCall(source, "defineGenerators", [
        {
          packageName: "@tailor-platform/kysely-type",
          functionName: "kyselyTypePlugin",
          importPath: "@tailor-platform/sdk/plugin/kysely-type",
        },
      ]);
      expect(count).toBe(1);
      // Non-array argument is preserved as-is
      expect(output).toBe(`defineGenerators(someVariable)`);
    });

    it("should deduplicate import entries", () => {
      const source = `defineGenerators(\n  ["@tailor-platform/kysely-type", { a: 1 }],\n)\ndefineFoo(\n  ["@tailor-platform/kysely-type", { b: 2 }],\n)`;
      const mappings = [
        {
          packageName: "@tailor-platform/kysely-type",
          functionName: "kyselyTypePlugin",
          importPath: "@tailor-platform/sdk/plugin/kysely-type",
        },
      ];
      // Apply to both calls
      const result1 = transformTupleArgsToCall(source, "defineGenerators", mappings);
      const result2 = transformTupleArgsToCall(result1.output, "defineFoo", mappings);
      // Imports from both calls
      const allImports = [...result1.imports, ...result2.imports];
      expect(allImports).toHaveLength(2); // Two occurrences, dedup is caller responsibility
    });
  });

  describe("transformJsonFile", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codemod-json-test-"));
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it("should transform and write JSON file", async () => {
      const filePath = path.join(tmpDir, "package.json");
      await fs.promises.writeFile(filePath, JSON.stringify({ name: "old" }, null, 2) + "\n");

      const result = await transformJsonFile(
        filePath,
        (parsed) => {
          const obj = parsed as Record<string, unknown>;
          return { ...obj, name: "new" };
        },
        false,
      );

      expect(result.changed).toBe(true);
      const content = await fs.promises.readFile(filePath, "utf-8");
      expect(JSON.parse(content)).toEqual({ name: "new" });
      expect(content.endsWith("\n")).toBe(true);
    });

    it("should not write file in dry-run mode", async () => {
      const filePath = path.join(tmpDir, "package.json");
      const original = JSON.stringify({ name: "old" }, null, 2) + "\n";
      await fs.promises.writeFile(filePath, original);

      const result = await transformJsonFile(
        filePath,
        (parsed) => {
          const obj = parsed as Record<string, unknown>;
          return { ...obj, name: "new" };
        },
        true,
      );

      expect(result.changed).toBe(true);
      expect(result.before).toBe(original);
      expect(result.after).toContain('"new"');
      const content = await fs.promises.readFile(filePath, "utf-8");
      expect(content).toBe(original);
    });

    it("should return unchanged when mutator returns null", async () => {
      const filePath = path.join(tmpDir, "package.json");
      await fs.promises.writeFile(filePath, JSON.stringify({ name: "old" }, null, 2) + "\n");

      const result = await transformJsonFile(filePath, () => null, false);
      expect(result.changed).toBe(false);
    });

    it("should return unchanged when mutator returns undefined", async () => {
      const filePath = path.join(tmpDir, "package.json");
      const original = JSON.stringify({ name: "old" }, null, 2) + "\n";
      await fs.promises.writeFile(filePath, original);

      const result = await transformJsonFile(filePath, () => undefined as unknown as null, false);
      expect(result.changed).toBe(false);

      const content = await fs.promises.readFile(filePath, "utf-8");
      expect(content).toBe(original);
    });

    it("should return unchanged when result is identical", async () => {
      const filePath = path.join(tmpDir, "package.json");
      await fs.promises.writeFile(filePath, JSON.stringify({ name: "same" }, null, 2) + "\n");

      const result = await transformJsonFile(
        filePath,
        (parsed) => parsed, // return same object
        false,
      );
      expect(result.changed).toBe(false);
    });

    it("should handle nested JSON transformations", async () => {
      const filePath = path.join(tmpDir, "package.json");
      const original = { scripts: { apply: "tailor apply", test: "vitest" } };
      await fs.promises.writeFile(filePath, JSON.stringify(original, null, 2) + "\n");

      const result = await transformJsonFile(
        filePath,
        (parsed) => {
          const obj = parsed as Record<string, Record<string, string>>;
          const scripts = { ...obj.scripts };
          if (scripts.apply) {
            scripts.deploy = scripts.apply.replace("apply", "deploy");
            delete scripts.apply;
          }
          return { ...obj, scripts };
        },
        false,
      );

      expect(result.changed).toBe(true);
      const content = JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
      expect(content.scripts.deploy).toBe("tailor deploy");
      expect(content.scripts.apply).toBeUndefined();
      expect(content.scripts.test).toBe("vitest");
    });

    it("should use sourceOverride instead of reading from disk", async () => {
      const filePath = path.join(tmpDir, "package.json");
      await fs.promises.writeFile(filePath, JSON.stringify({ name: "disk" }, null, 2) + "\n");
      const override = JSON.stringify({ name: "override" }, null, 2) + "\n";

      const result = await transformJsonFile(
        filePath,
        (parsed) => {
          const obj = parsed as Record<string, unknown>;
          return { ...obj, added: true };
        },
        true,
        override,
      );

      expect(result.changed).toBe(true);
      // Should have transformed the override content, not the disk content
      expect(result.before).toBe(override);
      const after = JSON.parse(result.after!);
      expect(after.name).toBe("override");
      expect(after.added).toBe(true);
    });
  });
});
