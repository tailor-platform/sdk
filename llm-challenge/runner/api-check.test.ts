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
  it("returns undefined when the problem has no apiCheck config", () => {
    const workDir = makeTempWorkDir();
    const meta: ProblemMeta = {
      id: "999",
      name: "no-api-check",
      difficulty: "easy",
      category: "integration",
      scoring: { generate: 1, typecheck: 1, tests: 1 },
      files: { implement: ["tailordb/user.ts"], scaffold: [] },
    };

    expect(runApiCheck(workDir, meta)).toBeUndefined();
  });

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

  it("rewrites aliased local names to the exported name when matching patterns", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db as tailorDb } from "@tailor-platform/sdk";',
        "export const user = tailorDb",
        "  .type('User', { name: tailorDb.string() })",
        "  .hooks({});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredPatterns: [
          {
            name: "type-level-hooks",
            pattern: "db\\s*\\.type\\([\\s\\S]*?\\.hooks\\s*\\(",
            message: "Need db.type(...).hooks()",
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      stage: "apiCheck",
      passed: true,
      testsPassed: 1,
      testsTotal: 1,
    });
  });

  it("scopes namespace alias prefix stripping per file", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    // File A: namespace import of SDK with alias `sdk`
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        "export const user = sdk.db.type('User', { name: sdk.db.string() });",
        "",
      ].join("\n"),
    );
    // File B: no SDK namespace import; an unrelated local `sdk` object exists
    fs.writeFileSync(
      path.join(workDir, "tailordb", "other.ts"),
      ["const sdk = { fakeApi: () => ({}) };", "export const helper = sdk.fakeApi();", ""].join(
        "\n",
      ),
    );

    const meta: ProblemMeta = {
      id: "999",
      name: "api-check-fixture",
      difficulty: "easy",
      category: "api-design",
      scoring: { generate: 1, apiCheck: 4, typecheck: 1, tests: 1 },
      files: {
        implement: ["tailordb/user.ts", "tailordb/other.ts"],
        scaffold: [],
      },
      apiCheck: {
        // If the alias-strip leaks across files, `sdk.` would be removed from
        // other.ts and this required pattern would fail to find `sdk.fakeApi(`.
        requiredPatterns: [
          {
            name: "uses-db-type",
            pattern: "db\\s*\\.type\\(",
            files: ["tailordb/user.ts"],
            message: "Need db.type",
          },
          {
            name: "preserves-local-sdk",
            pattern: "sdk\\.fakeApi\\(",
            files: ["tailordb/other.ts"],
            message: "Local sdk.fakeApi must not be alias-stripped",
          },
        ],
      },
    };

    const result = runApiCheck(workDir, meta);

    expect(result).toMatchObject({ stage: "apiCheck", passed: true });
  });

  it("strips namespace alias prefix when matching patterns", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        "export const user = sdk.db",
        "  .type('User', { name: sdk.db.string() })",
        "  .hooks({});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredPatterns: [
          {
            name: "type-level-hooks",
            pattern: "db\\s*\\.type\\([\\s\\S]*?\\.hooks\\s*\\(",
            message: "Need db.type(...).hooks()",
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      stage: "apiCheck",
      passed: true,
      testsPassed: 1,
      testsTotal: 1,
    });
  });

  it("does not rewrite aliases when searchScope is raw", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db as kysely } from "@tailor-platform/sdk";',
        'import "@tailor-platform/kysely-types";',
        "export const user = kysely.type('User', {});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "legacy-package",
            pattern: "@tailor-platform/kysely-types",
            searchScope: "raw",
            message: "Use @tailor-platform/kysely-type",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Use @tailor-platform/kysely-type");
  });

  it("ignores comments and string literals when matching API patterns", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "// Note: do not use createResolver or t.object here.",
        'const docExample = "createResolver should not be used";',
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSdkImports: ["db"],
        forbiddenPatterns: [
          {
            name: "no-create-resolver",
            pattern: "createResolver",
            message: "Do not use createResolver",
          },
        ],
        requiredPatterns: [
          {
            name: "uses-db-type",
            pattern: "db\\.type\\(",
            message: "Must call db.type",
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      stage: "apiCheck",
      passed: true,
      testsPassed: 3,
      testsTotal: 3,
    });
  });

  it("flags field-level hooks chained off db.<field>() as forbidden", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "export const user = db.type('User', {",
        "  slug: db.string().unique().hooks({ create: ({ value }) => value }),",
        "});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "field-level-hooks",
            pattern:
              "db\\s*\\.(?!type\\b)\\w+\\([^()]*\\)(\\s*\\.\\w+\\([^()]*\\))*\\s*\\.hooks\\s*\\(",
            message: "no field-level hooks",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("no field-level hooks");
  });

  it("preserves forbidden module specifiers when stripping string bodies", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        'import "@tailor-platform/kysely-types";',
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "legacy-package",
            pattern: "@tailor-platform/kysely-types",
            message: "Use @tailor-platform/kysely-type",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Use @tailor-platform/kysely-type");
  });

  it("matches forbidden patterns against raw source when searchScope is raw", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db, defineConfig } from "@tailor-platform/sdk";',
        "export const user = db.type('User', { name: db.string() });",
        "// Generator config below intentionally uses the legacy hyphenated name.",
        'defineConfig({ name: "x", plugins: { name: "@tailor-platform/kysely-types" } });',
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "legacy-package",
            pattern: "@tailor-platform/kysely-types",
            searchScope: "raw",
            message: "Use @tailor-platform/kysely-type",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Use @tailor-platform/kysely-type");
  });

  it("treats namespace import as satisfying required imports", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        "export const user = sdk.db.type('User', { name: sdk.db.string() });",
        "sdk.defineConfig({ name: 'x' });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSdkImports: ["db", "defineConfig"],
      }),
    );

    expect(result).toMatchObject({
      stage: "apiCheck",
      passed: true,
      testsPassed: 2,
      testsTotal: 2,
    });
  });

  it("does not flag unrelated namespace members when nothing forbidden is used", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        "export const user = sdk.db.type('User', { name: sdk.db.string() });",
        "sdk.defineConfig({ name: 'x' });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenSdkImports: ["createExecutor"],
      }),
    );

    expect(result).toMatchObject({ stage: "apiCheck", passed: true });
    if (!result) throw new Error("api check result should exist");
    expect(result.output).not.toContain("Forbidden @tailor-platform/sdk");
  });

  it("does not inline db chains across function-parameter shadowing", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "function format(slug: string) { return slug.toLowerCase(); }",
        "export const user = db",
        "  .type('User', { slug: db.string().unique() })",
        "  .hooks({ slug: { create: ({ value }) => format(value ?? '') } });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "field-level-hooks",
            pattern:
              "db\\s*\\.(?!type\\b)\\w+\\([^()]*\\)(\\s*\\.\\w+\\([^()]*\\))*\\s*\\.hooks\\s*\\(",
            message: "no field-level hooks",
          },
        ],
      }),
    );

    expect(result).toMatchObject({ stage: "apiCheck", passed: true });
  });

  it("flags forbidden symbols accessed through a namespace alias", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        "export const user = sdk.db.type('User', { name: sdk.db.string() });",
        "sdk.createExecutor({});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenSdkImports: ["createExecutor"],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain(
      "Forbidden @tailor-platform/sdk usage via namespace import: createExecutor",
    );
  });

  it("flags forbidden symbols accessed via computed namespace property", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        'const fn = sdk["createExecutor"];',
        "fn({});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenSdkImports: ["createExecutor"],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain(
      "Forbidden @tailor-platform/sdk usage via namespace import: createExecutor",
    );
  });

  it("flags forbidden symbols destructured from a namespace alias", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        "const { createExecutor } = sdk;",
        "export const user = sdk.db.type('User', { name: sdk.db.string() });",
        "createExecutor({});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenSdkImports: ["createExecutor"],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain(
      "Forbidden @tailor-platform/sdk usage via namespace import: createExecutor",
    );
  });

  it("still flags forbidden named imports alongside a namespace import", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import * as sdk from "@tailor-platform/sdk";',
        'import { createResolver } from "@tailor-platform/sdk";',
        "export const user = sdk.db.type('User', { name: sdk.db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSdkImports: ["db"],
        forbiddenSdkImports: ["createResolver"],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Forbidden @tailor-platform/sdk import: createResolver");
  });

  it("flags field-level hooks routed through a local variable", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "const slugBase = db.string().unique();",
        "const slug = slugBase.hooks({ create: ({ value }) => value });",
        "export const user = db.type('User', { slug });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "field-level-hooks",
            pattern:
              "db\\s*\\.(?!type\\b)\\w+\\([^()]*\\)(\\s*\\.\\w+\\([^()]*\\))*\\s*\\.hooks\\s*\\(",
            message: "no field-level hooks",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("no field-level hooks");
  });

  it("flags parenthesized field-level hooks via paren unwrapping", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "export const user = db.type('User', {",
        "  slug: (db.string().unique()).hooks({ create: ({ value }) => value }),",
        "});",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        forbiddenPatterns: [
          {
            name: "field-level-hooks",
            pattern:
              "db\\s*\\.(?!type\\b)\\w+\\([^()]*\\)(\\s*\\.\\w+\\([^()]*\\))*\\s*\\.hooks\\s*\\(",
            message: "no field-level hooks",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("no field-level hooks");
  });

  it("does not credit required patterns that only appear in comments", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "// We should call db.type('User', ...) somewhere.",
        "export const user = db.string();",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredPatterns: [
          {
            name: "uses-db-type",
            pattern: "db\\.type\\(",
            message: "Must call db.type",
          },
        ],
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Must call db.type");
  });

  it("passes requiredSymbols when every named symbol is referenced in the target file", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db, createResolver } from "@tailor-platform/sdk";',
        "createResolver({ name: 'noop' });",
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "tailordb/user.ts": ["createResolver", "db"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(true);
    expect(result.omissions).toBeUndefined();
  });

  it("fails requiredSymbols and surfaces a per-file omissions list when symbols are missing", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "tailordb/user.ts": ["createResolver", "createExecutor"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain('Missing required symbol "createResolver"');
    expect(result.output).toContain('Missing required symbol "createExecutor"');
    expect(result.omissions).toEqual([
      { file: "tailordb/user.ts", missingSymbols: ["createResolver", "createExecutor"] },
    ]);
  });

  it("does not credit a symbol that only appears in a comment or string literal", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "// Note: use createResolver when wiring custom logic",
        'const note = "createResolver is required for custom GraphQL resolvers";',
        "export const user = db.type('User', { name: db.string() });",
        "void note;",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "tailordb/user.ts": ["createResolver"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain('Missing required symbol "createResolver"');
  });

  it("does not credit an imported-but-unused symbol toward requiredSymbols", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        // createResolver is imported but never referenced in the body. An
        // import alone should not satisfy a requiredSymbols check.
        'import { db, createResolver } from "@tailor-platform/sdk";',
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "tailordb/user.ts": ["createResolver"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain('Missing required symbol "createResolver"');
  });

  it("does not credit a symbol that only appears in an aliased import to requiredSymbols", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        // The exported name `createResolver` only appears as the property
        // side of an aliased import. The body only uses the local alias `r`.
        'import { db, createResolver as r } from "@tailor-platform/sdk";',
        "r({ name: 'noop' });",
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "tailordb/user.ts": ["createResolver"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain('Missing required symbol "createResolver"');
  });

  it("does not credit a local declaration or property key as a reference", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        // None of these positions actually reference `createResolver`:
        // - object literal property key
        // - function declaration name
        // - class declaration name
        // - type alias name
        "const flags = { createResolver: false };",
        "function createResolverFactory() { return flags; }",
        "class CreateResolverContainer { createResolver = 1; }",
        "type createResolver = string;",
        "createResolverFactory(); new CreateResolverContainer();",
        "export const user = db.type('User', { name: db.string() });",
        "",
      ].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "tailordb/user.ts": ["createResolver"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain('Missing required symbol "createResolver"');
  });

  it("flags a requiredSymbols entry that points outside files.implement as misconfigured", () => {
    const workDir = makeTempWorkDir();
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, "tailordb", "user.ts"),
      ['import { db } from "@tailor-platform/sdk";', "export const user = db;"].join("\n"),
    );

    const result = runApiCheck(
      workDir,
      makeMeta({
        requiredSymbols: {
          "elsewhere/never-listed.ts": ["createResolver"],
        },
      }),
    );

    expect(result).toBeDefined();
    if (!result) throw new Error("api check result should exist");
    expect(result.passed).toBe(false);
    expect(result.output).toContain(
      'required-symbols entry references "elsewhere/never-listed.ts" which is not in files.implement',
    );
  });
});
