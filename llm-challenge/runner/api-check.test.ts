import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runApiCheck } from "./api-check";
import type { ProblemMeta } from "../shared/helpers";

const tmpDirs: string[] = [];

function makeTempWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-api-check-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "node_modules", "@tailor-platform", "sdk", "dist", "configure"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, "node_modules", "@tailor-platform", "sdk", "dist", "configure", "index.d.mts"),
    [
      'export { db, createResolver, defineConfig, createExecutor } from "../index.mjs";',
      "export type { TailorUser } from '../index.mjs';",
      "",
    ].join("\n"),
  );
  return dir;
}

function makeMeta(apiCheck: ProblemMeta["apiCheck"]): ProblemMeta {
  return {
    id: "999",
    name: "api-check-fixture",
    difficulty: "easy",
    category: "api-design",
    apiSurfaces: ["tailordb.field"],
    scoring: { generate: 1, apiCheck: 4, typecheck: 1, tests: 1 },
    files: {
      implement: ["tailordb/user.ts"],
      scaffold: [],
    },
    apiCheck,
  };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runApiCheck", () => {
  it("passes when required SDK imports are present and exported by the package", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db, defineConfig } from "@tailor-platform/sdk";',
        "export const user = db.type('User', { name: db.string() });",
        "defineConfig({ name: 'x' });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(workDir, makeMeta({ requiredSdkImports: ["db", "defineConfig"] }));

    expect(result).toMatchObject({
      stage: "apiCheck",
      passed: true,
      testsPassed: 2,
      testsTotal: 2,
    });
  });

  it("resolves aliased imports to the exported symbol name", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db as tailorDb, defineConfig } from "@tailor-platform/sdk";',
        "export const user = tailorDb.type('User', { name: tailorDb.string() });",
        "defineConfig({ name: 'x' });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(workDir, makeMeta({ requiredSdkImports: ["db", "defineConfig"] }));

    expect(result).toMatchObject({
      stage: "apiCheck",
      passed: true,
      testsPassed: 2,
      testsTotal: 2,
    });
  });

  it("fails unknown and forbidden SDK imports before typecheck", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db, defineResolver, createExecutor } from "@tailor-platform/sdk";',
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({ forbiddenSdkImports: ["createExecutor"], requiredSdkImports: ["defineConfig"] }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.testsPassed).toBe(0);
    expect(result.testsTotal).toBe(3);
    expect(result.output).toContain("Unknown @tailor-platform/sdk import: defineResolver");
    expect(result.output).toContain("Forbidden @tailor-platform/sdk import: createExecutor");
    expect(result.output).toContain("Missing required @tailor-platform/sdk import: defineConfig");
  });
});
