import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analyzeFileCanonicalness,
  computeCanonicalnessStats,
  isCanonicalSdkImport,
} from "./metrics-canonicalness";

describe("isCanonicalSdkImport", () => {
  it.each([
    "@tailor-platform/sdk",
    "@tailor-platform/sdk/plugin/kysely-type",
    "@tailor-platform/sdk/plugin/seed",
    "@tailor-platform/sdk/vitest",
  ])("treats %s as canonical", (spec) => {
    expect(isCanonicalSdkImport(spec)).toBe(true);
  });

  it.each([
    "@tailor-platform/sdk/dist/cli/index.mjs",
    "@tailor-platform/sdk/src/internal",
    "@tailor-platform/kysely-types",
    "@tailor-platform/some-other-package",
  ])("treats %s as non-canonical", (spec) => {
    expect(isCanonicalSdkImport(spec)).toBe(false);
  });

  it("ignores non-@tailor-platform imports (returns true to avoid penalising)", () => {
    expect(isCanonicalSdkImport("react")).toBe(true);
    expect(isCanonicalSdkImport("./local")).toBe(true);
    expect(isCanonicalSdkImport("@types/node")).toBe(true);
  });
});

describe("analyzeFileCanonicalness", () => {
  it("counts only @tailor-platform/ imports, classifying each", () => {
    const src = `
      import { defineConfig } from "@tailor-platform/sdk";
      import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
      import { weird } from "@tailor-platform/kysely-types";
      import path from "node:path";
      import { other } from "./local";
    `;
    expect(analyzeFileCanonicalness(src)).toEqual({ total: 3, canonical: 2 });
  });

  it("returns zeros when no @tailor-platform imports exist", () => {
    expect(analyzeFileCanonicalness("import { x } from 'react';\n")).toEqual({
      total: 0,
      canonical: 0,
    });
  });
});

describe("computeCanonicalnessStats", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-canon-test-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("returns ratio = 1.0 when there are zero imports (vacuous truth)", () => {
    fs.writeFileSync(path.join(workDir, "a.ts"), "export const x = 1;\n");
    const stats = computeCanonicalnessStats(workDir);
    expect(stats.totalImports).toBe(0);
    expect(stats.canonicalImports).toBe(0);
    expect(stats.canonicalImportRatio).toBe(1.0);
  });

  it("aggregates across multiple files and counts non-canonical hits", () => {
    fs.writeFileSync(
      path.join(workDir, "a.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\n`,
    );
    fs.writeFileSync(
      path.join(workDir, "b.ts"),
      `import { foo } from "@tailor-platform/kysely-types";\nimport { bar } from "@tailor-platform/sdk/plugin/kysely-type";\n`,
    );
    const stats = computeCanonicalnessStats(workDir);
    expect(stats.totalImports).toBe(3);
    expect(stats.canonicalImports).toBe(2);
    expect(stats.canonicalImportRatio).toBeCloseTo(2 / 3, 4);
  });

  it("skips node_modules / .sdk / dist directories", () => {
    fs.mkdirSync(path.join(workDir, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "node_modules", "x", "y.ts"),
      `import { z } from "@tailor-platform/kysely-types";\n`,
    );
    fs.writeFileSync(
      path.join(workDir, "a.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\n`,
    );
    const stats = computeCanonicalnessStats(workDir);
    expect(stats.totalImports).toBe(1);
    expect(stats.canonicalImports).toBe(1);
  });

  it("returns ratio=1.0 for a missing workDir without throwing", () => {
    fs.rmSync(workDir, { recursive: true, force: true });
    const stats = computeCanonicalnessStats(workDir);
    expect(stats.canonicalImportRatio).toBe(1.0);
  });
});
