import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { findUndocumentedSymbols } from "./find-undocumented-symbols.js";

const fixturesDir = resolve(import.meta.dirname, "__fixtures__");

function check(...files: string[]) {
  const entryPoints = files.map((f) => resolve(fixturesDir, f));
  return findUndocumentedSymbols(entryPoints, {}, fixturesDir);
}

function names(failures: { name: string }[]) {
  return failures.map((f) => f.name).toSorted();
}

describe("findUndocumentedSymbols", () => {
  test("fully documented symbols produce no failures", { timeout: 10_000 }, () => {
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
