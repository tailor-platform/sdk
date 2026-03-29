import { resolve } from "node:path";
import { type Linter, ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, test } from "vitest";
// @ts-expect-error -- JS-only plugin entry with no declaration file
import localPlugin from "../index.js";
import { findUndocumentedSymbols } from "../require-public-api-jsdoc.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");
const sdkDir = resolve(import.meta.dirname, "../..");

function check(...files: string[]) {
  const entryPoints = files.map((f) => resolve(fixturesDir, f));
  return findUndocumentedSymbols(entryPoints, {}, fixturesDir);
}

function names(failures: { name: string }[]) {
  return failures.map((f) => f.name).sort();
}

describe("require-public-api-jsdoc", () => {
  test("fully documented symbols produce no failures", () => {
    expect(check("documented.ts")).toEqual([]);
  });

  test("detects all undocumented symbol kinds", () => {
    const result = check("undocumented.ts");
    const byName = Object.fromEntries(result.map((f) => [f.name, f.kind]));
    expect(byName).toMatchObject({
      undocumentedVar: "Variable",
      undocumentedFunc: "Function",
      UndocumentedClass: "Class",
      "UndocumentedClass.undocumentedMethod": "Method",
      "UndocumentedClass.undocumentedAccessor": "Accessor",
      UndocumentedEnum: "Enum",
    });
    expect(names(result)).toContain("UndocumentedEnum.X");
    expect(names(result)).toContain("UndocumentedEnum.Y");
  });

  test("private and protected class members are skipped", () => {
    const result = check("documented.ts");
    const detected = names(result);
    expect(detected).not.toContain("DocumentedClass.internalHelper");
    expect(detected).not.toContain("DocumentedClass.onEvent");
  });

  test("type-only exports are skipped", () => {
    expect(check("type-only.ts")).toEqual([]);
  });

  test("re-exported symbol with JSDoc at source passes", () => {
    const result = check("re-export-entry.ts");
    expect(names(result)).not.toContain("documentedAtSource");
  });

  test("re-exported symbol without JSDoc is detected", () => {
    const result = check("re-export-entry.ts");
    expect(names(result)).toContain("undocumentedAtSource");
  });

  test("external package re-exports are skipped", () => {
    expect(check("external-re-export.ts")).toEqual([]);
  });

  test("mixed file: only undocumented value symbols are detected", () => {
    const result = check("mixed.ts");
    const detected = names(result);
    expect(detected).toContain("undocVar");
    expect(detected).toContain("Status.Inactive");
    expect(detected).not.toContain("docVar");
    expect(detected).not.toContain("OnlyType");
    expect(detected).not.toContain("Status.Active");
  });
});

describe("ESLint rule integration", () => {
  function createEslint(fixtureGlob: string) {
    return new ESLint({
      cwd: sdkDir,
      overrideConfig: [
        ...tseslint.configs.recommended,
        {
          languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: sdkDir },
          },
        },
        {
          files: [fixtureGlob],
          plugins: { local: localPlugin },
          rules: { "local/require-public-api-jsdoc": "error" },
        },
      ],
      overrideConfigFile: true,
    });
  }

  function messageNames(messages: Linter.LintMessage[]) {
    return messages
      .map((m) => {
        const match = m.message.match(/Public API \w+ '(.+?)'/);
        return match?.[1];
      })
      .filter(Boolean)
      .sort();
  }

  test("reports undocumented symbols via ESLint", { timeout: 30_000 }, async () => {
    const eslint = createEslint("eslint-rules/__tests__/fixtures/undocumented.ts");
    const [result] = await eslint.lintFiles([resolve(fixturesDir, "undocumented.ts")]);
    const detected = messageNames(result.messages);
    expect(detected).toContain("undocumentedVar");
    expect(detected).toContain("undocumentedFunc");
    expect(detected).toContain("UndocumentedClass");
    expect(detected).toContain("UndocumentedClass.undocumentedMethod");
    expect(detected).toContain("UndocumentedClass.undocumentedAccessor");
    expect(detected).toContain("UndocumentedEnum");
  });

  test("reports no errors for documented symbols", async () => {
    const eslint = createEslint("eslint-rules/__tests__/fixtures/documented.ts");
    const [result] = await eslint.lintFiles([resolve(fixturesDir, "documented.ts")]);
    const ruleMessages = result.messages.filter(
      (m) => m.ruleId === "local/require-public-api-jsdoc",
    );
    expect(ruleMessages).toEqual([]);
  });

  test("resolves re-exported symbols through source files", async () => {
    const eslint = createEslint("eslint-rules/__tests__/fixtures/re-export-entry.ts");
    const [result] = await eslint.lintFiles([resolve(fixturesDir, "re-export-entry.ts")]);
    const detected = messageNames(result.messages);
    expect(detected).toContain("undocumentedAtSource");
    expect(detected).not.toContain("documentedAtSource");
  });
});
