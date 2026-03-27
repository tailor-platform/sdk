import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { findUndocumentedSymbols } from "../lint-public-api.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

function check(...files: string[]) {
  const entryPoints = files.map((f) => resolve(fixturesDir, f));
  return findUndocumentedSymbols(entryPoints, {}, fixturesDir);
}

function names(failures: { name: string }[]) {
  return failures.map((f) => f.name).sort();
}

describe("lint-public-api", () => {
  test("fully documented symbols produce no failures", () => {
    expect(check("documented.ts")).toEqual([]);
  });

  test("undocumented variable is detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("undocumentedVar");
    expect(result.find((f) => f.name === "undocumentedVar")?.kind).toBe("Variable");
  });

  test("undocumented function is detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("undocumentedFunc");
    expect(result.find((f) => f.name === "undocumentedFunc")?.kind).toBe("Function");
  });

  test("undocumented class is detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("UndocumentedClass");
    expect(result.find((f) => f.name === "UndocumentedClass")?.kind).toBe("Class");
  });

  test("undocumented class method is detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("UndocumentedClass.undocumentedMethod");
    expect(result.find((f) => f.name === "UndocumentedClass.undocumentedMethod")?.kind).toBe(
      "Method",
    );
  });

  test("undocumented class accessor is detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("UndocumentedClass.undocumentedAccessor");
    expect(result.find((f) => f.name === "UndocumentedClass.undocumentedAccessor")?.kind).toBe(
      "Accessor",
    );
  });

  test("undocumented enum is detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("UndocumentedEnum");
    expect(result.find((f) => f.name === "UndocumentedEnum")?.kind).toBe("Enum");
  });

  test("undocumented enum members are detected", () => {
    const result = check("undocumented.ts");
    expect(names(result)).toContain("UndocumentedEnum.X");
    expect(names(result)).toContain("UndocumentedEnum.Y");
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
