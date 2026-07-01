import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";

const CODEMODS_DIR = path.resolve(__dirname, "../codemods");

const runtimeGlobals = allCodemods.find((codemod) => codemod.id === "v2/runtime-globals-opt-in");

if (!runtimeGlobals?.scriptPath) {
  throw new Error("v2/runtime-globals-opt-in codemod is not registered with a script");
}

const runtimeGlobalsEntry = {
  codemod: runtimeGlobals,
  scriptPath: path.join(CODEMODS_DIR, runtimeGlobals.scriptPath.replace(/\.js$/, ".ts")),
};

describe("runtime-globals-opt-in review findings", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function writeProjectFile(relative: string, source: string): Promise<void> {
    tmpDir ??= await fs.promises.mkdtemp(path.join(os.tmpdir(), "runtime-globals-review-test-"));
    const file = path.join(tmpDir, relative);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, source, "utf-8");
  }

  test("reports runtime globals left in embedded code strings", async () => {
    await writeProjectFile(
      "seed/exec.mjs",
      [
        "const idpSeedCode = `",
        "async function run() {",
        '  const client = new tailor.idp.Client({ namespace: "default" });',
        "  await client.users();",
        "}",
        "`;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/exec.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/exec.mjs",
            line: 3,
            message: expect.stringContaining("Embedded code string"),
            excerpt: 'const client = new tailor.idp.Client({ namespace: "default" });',
          }),
        ],
      }),
    ]);
  });

  test("reports embedded code strings when syntax cue and global split lines", async () => {
    await writeProjectFile(
      "seed/wrapped.mjs",
      ["const code = `", "const C =", " tailor.idp.Client;", "`;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/wrapped.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/wrapped.mjs",
            line: 3,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("reports spaced bracket runtime globals inside embedded code strings", async () => {
    await writeProjectFile(
      "seed/spaced-bracket.mjs",
      [
        "const code = `",
        'const clientFactory = tailor ["idp"].Client;',
        'const upload = tailordb ["file"].upload;',
        "`;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/spaced-bracket.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/spaced-bracket.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: 'const clientFactory = tailor ["idp"].Client;',
          }),
          expect.objectContaining({
            file: "seed/spaced-bracket.mjs",
            line: 3,
            message: expect.stringContaining("Embedded code string"),
            excerpt: 'const upload = tailordb ["file"].upload;',
          }),
        ],
      }),
    ]);
  });

  test("reports casted runtime globals inside embedded code strings", async () => {
    await writeProjectFile(
      "seed/casted-root.mjs",
      ["const code = `", "const c = (tailor as any).idp.Client;", "`;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/casted-root.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/casted-root.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const c = (tailor as any).idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("reports direct runtime globals skipped because of binding collisions", async () => {
    await writeProjectFile(
      "resolvers/createUser.ts",
      [
        "const idp = {};",
        'const client = new tailor.idp.Client({ namespace: "default" });',
        "await client.users();",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/createUser.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/createUser.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const client = new tailor.idp.Client({ namespace: "default" });',
          }),
        ],
      }),
    ]);
  });

  test("reports aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-alias.ts",
      ["const runtime = globalThis.tailor;", "const clientFactory = runtime.idp.Client;", ""].join(
        "\n",
      ),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-alias.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-alias.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const runtime = globalThis.tailor;",
          }),
        ],
      }),
    ]);
  });

  test("reports bracket aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-bracket-alias.ts",
      ["const dbRuntime = global['tailordb'];", "const upload = dbRuntime.file.upload;", ""].join(
        "\n",
      ),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-bracket-alias.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-bracket-alias.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const dbRuntime = global['tailordb'];",
          }),
        ],
      }),
    ]);
  });

  test("reports casted aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-casted-alias.ts",
      [
        "const runtime = (globalThis as any).tailor;",
        "const clientFactory = runtime.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-casted-alias.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-casted-alias.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const runtime = (globalThis as any).tailor;",
          }),
        ],
      }),
    ]);
  });

  test("reports bracket runtime globals left for manual migration", async () => {
    await writeProjectFile(
      "resolvers/dynamic.ts",
      [
        'const clientFactory = tailor["idp"].Client;',
        'const file = tailordb["file"].upload;',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/dynamic.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/dynamic.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const clientFactory = tailor["idp"].Client;',
          }),
          expect.objectContaining({
            file: "resolvers/dynamic.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const file = tailordb["file"].upload;',
          }),
        ],
      }),
    ]);
  });

  test("reports bare subscript and type runtime globals left for manual migration", async () => {
    await writeProjectFile(
      "resolvers/types.ts",
      [
        'const runtimeNamespace = tailor["idp"];',
        "type Query = tailordb.QueryResult<User>;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/types.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/types.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const runtimeNamespace = tailor["idp"];',
          }),
          expect.objectContaining({
            file: "resolvers/types.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "type Query = tailordb.QueryResult<User>;",
          }),
        ],
      }),
    ]);
  });

  test("does not report prose-only runtime global mentions inside strings", async () => {
    await writeProjectFile(
      "seed/prose.mjs",
      [
        'console.log("Truncating _User via tailor.idp.Client before reseeding");',
        'console.log("Please renew tailor.idp.Client credentials");',
        'console.log("Use the migration guide before changing runtime globals");',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report prose runtime globals inside direct code wrappers", async () => {
    await writeProjectFile(
      "errors.ts",
      ['throw new Error("Please renew tailor.idp.Client credentials");', ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report locally bound spaced bracket runtime-looking names", async () => {
    await writeProjectFile(
      "resolvers/local.ts",
      ["const tailor = {};", 'const localClient = tailor ["idp"].Client;', ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report local declarations after spaced bracket runtime-looking names", async () => {
    await writeProjectFile(
      "resolvers/local-after.ts",
      ['const localClient = tailor ["idp"].Client;', "const tailor = {};", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report local function runtime-looking names", async () => {
    await writeProjectFile(
      "resolvers/local-function.ts",
      ["function tailor() {}", 'const localClient = tailor ["idp"].Client;', ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports spaced bracket runtime globals outside unrelated binding scopes", async () => {
    await writeProjectFile(
      "resolvers/scoped.ts",
      [
        "function capture(tailor: unknown) {}",
        'const clientFactory = tailor ["idp"].Client;',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/scoped.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/scoped.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const clientFactory = tailor ["idp"].Client;',
          }),
        ],
      }),
    ]);
  });

  test("reports optional and non-null bracket runtime globals", async () => {
    await writeProjectFile(
      "resolvers/optional-bracket.ts",
      [
        'const clientFactory = tailor?.["idp"].Client;',
        'const upload = tailordb!["file"].upload;',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/optional-bracket.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/optional-bracket.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const clientFactory = tailor?.["idp"].Client;',
          }),
          expect.objectContaining({
            file: "resolvers/optional-bracket.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const upload = tailordb!["file"].upload;',
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals when idp is used in binding expressions", async () => {
    await writeProjectFile(
      "resolvers/idp-binding-expression.ts",
      [
        "const { [idp]: keyedValue, x = idp.foo } = opts;",
        'const client = new tailor.idp.Client({ namespace: "default" });',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/idp-binding-expression.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/idp-binding-expression.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const client = new tailor.idp.Client({ namespace: "default" });',
          }),
        ],
      }),
    ]);
  });

  test("reports spaced bracket runtime globals outside unrelated method parameter scopes", async () => {
    await writeProjectFile(
      "resolvers/method-scoped.ts",
      [
        "class Local {",
        "  method(tailor: unknown) {}",
        "}",
        'const clientFactory = tailor ["idp"].Client;',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/method-scoped.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/method-scoped.ts",
            line: 4,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const clientFactory = tailor ["idp"].Client;',
          }),
        ],
      }),
    ]);
  });

  test("reports value runtime globals hidden only by type namespace bindings", async () => {
    await writeProjectFile(
      "resolvers/type-namespace.ts",
      [
        'import type { tailor } from "./types";',
        "interface tailordb {}",
        "type TailorErrors = Error;",
        'const clientFactory = tailor ["idp"].Client;',
        'const upload = tailordb ["file"].upload;',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/type-namespace.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/type-namespace.ts",
            line: 4,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const clientFactory = tailor ["idp"].Client;',
          }),
          expect.objectContaining({
            file: "resolvers/type-namespace.ts",
            line: 5,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const upload = tailordb ["file"].upload;',
          }),
        ],
      }),
    ]);
  });

  test("does not report type-only namespace import qualified types", async () => {
    await writeProjectFile(
      "resolvers/type-namespace-import.ts",
      ['import type * as tailor from "./types";', "type User = tailor.idp.User;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports runtime globals outside type signature parameters", async () => {
    await writeProjectFile(
      "resolvers/type-signature-parameter.ts",
      ["type Fn = (tailor: unknown) => void;", "const clientFactory = tailor.idp.Client;", ""].join(
        "\n",
      ),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/type-signature-parameter.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/type-signature-parameter.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals outside inline function type parameters", async () => {
    await writeProjectFile(
      "resolvers/inline-function-type-parameter.ts",
      [
        "function run(_: (tailor: unknown) => void) {",
        "  const clientFactory = tailor.idp.Client;",
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/inline-function-type-parameter.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/inline-function-type-parameter.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("does not report local arrow for or catch runtime-looking names", async () => {
    await writeProjectFile(
      "resolvers/local-binding-forms.ts",
      [
        'const getClient = (tailor: any) => tailor ["idp"].Client;',
        "for (const tailordb of sources) {",
        '  tailordb ["file"].upload;',
        "}",
        "try {",
        "  run();",
        "} catch (tailor) {",
        '  tailor ["idp"].Client;',
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report self-named function expressions", async () => {
    await writeProjectFile(
      "resolvers/self-named-function.ts",
      ["const run = function tailor() {", "  return tailor.idp.Client;", "};", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports runtime globals outside namespace var bindings", async () => {
    await writeProjectFile(
      "resolvers/namespace-var-outside.ts",
      [
        "namespace N {",
        "  var tailor: unknown;",
        "}",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/namespace-var-outside.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/namespace-var-outside.ts",
            line: 4,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("does not report namespace-local runtime-looking vars", async () => {
    await writeProjectFile(
      "resolvers/namespace-var-local.ts",
      ["namespace N {", "  var tailor: unknown;", "  tailor.idp.Client;", "}", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report runtime-looking import or export declarations", async () => {
    await writeProjectFile(
      "resolvers/type-imports.ts",
      [
        'import type { TailorErrors } from "./types";',
        'export type { TailorErrors as RuntimeTailorErrors } from "./types";',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports import-equals runtime globals left for manual migration", async () => {
    await writeProjectFile(
      "resolvers/import-equals.ts",
      ["import Idp = tailor.idp;", "import Result = tailordb.QueryResult;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/import-equals.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/import-equals.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "import Idp = tailor.idp;",
          }),
          expect.objectContaining({
            file: "resolvers/import-equals.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "import Result = tailordb.QueryResult;",
          }),
        ],
      }),
    ]);
  });

  test("reports local export clauses that reference runtime globals", async () => {
    await writeProjectFile(
      "resolvers/export-local.ts",
      ["export { TailorErrors };", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/export-local.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/export-local.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "export { TailorErrors };",
          }),
        ],
      }),
    ]);
  });

  test("does not report local type-only export clauses", async () => {
    await writeProjectFile(
      "resolvers/export-local-type.ts",
      ["type TailorErrors = Error;", "export type { TailorErrors };", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report local per-specifier type-only export clauses", async () => {
    await writeProjectFile(
      "resolvers/export-local-specifier-type.ts",
      ["type TailorErrors = Error;", "export { type TailorErrors };", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports runtime globals inside classic for loop bodies", async () => {
    await writeProjectFile(
      "resolvers/for-body.ts",
      [
        "for (let i = 0; i < 1; i++) {",
        '  const clientFactory = tailor ["idp"].Client;',
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/for-body.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/for-body.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const clientFactory = tailor ["idp"].Client;',
          }),
        ],
      }),
    ]);
  });

  test("does not report hoisted var runtime-looking bindings", async () => {
    await writeProjectFile(
      "resolvers/hoisted-var.ts",
      [
        "function run() {",
        "  if (ok) {",
        "    var tailor = {};",
        "  }",
        "  tailor.idp.Client;",
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports runtime globals outside class static block var bindings", async () => {
    await writeProjectFile(
      "resolvers/static-block-var-outside.ts",
      [
        "class Local {",
        "  static {",
        "    var tailor: unknown;",
        "  }",
        "}",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/static-block-var-outside.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/static-block-var-outside.ts",
            line: 6,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("does not report class static block local var bindings", async () => {
    await writeProjectFile(
      "resolvers/static-block-var-local.ts",
      [
        "class Local {",
        "  static {",
        "    var tailor: unknown;",
        "    tailor.idp.Client;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports runtime globals inside self-closing JSX in js files", async () => {
    await writeProjectFile(
      "components/view.js",
      ["export const view = <Foo value={tailor.idp.Client} />;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["components/view.js"],
        findings: [
          expect.objectContaining({
            file: "components/view.js",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "export const view = <Foo value={tailor.idp.Client} />;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals inside intrinsic self-closing JSX in js files", async () => {
    await writeProjectFile(
      "components/intrinsic.js",
      ["export const view = <div value={tailor.idp.Client} />;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["components/intrinsic.js"],
        findings: [
          expect.objectContaining({
            file: "components/intrinsic.js",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "export const view = <div value={tailor.idp.Client} />;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals inside js JSX attributes containing comparison operators", async () => {
    await writeProjectFile(
      "components/comparison.js",
      ["export const view = <Foo value={count > tailor.idp.Client} />;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["components/comparison.js"],
        findings: [
          expect.objectContaining({
            file: "components/comparison.js",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "export const view = <Foo value={count > tailor.idp.Client} />;",
          }),
        ],
      }),
    ]);
  });

  test("keeps ts files with jsx-like strings in TypeScript mode", async () => {
    await writeProjectFile(
      "resolvers/type-assertion.ts",
      [
        'const template = "<Foo />";',
        "const casted = <Bar>value;",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/type-assertion.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/type-assertion.ts",
            line: 3,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals inside destructuring defaults", async () => {
    await writeProjectFile(
      "resolvers/destructuring-default.ts",
      ['const { client = tailor ["idp"].Client } = opts;', ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/destructuring-default.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/destructuring-default.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const { client = tailor ["idp"].Client } = opts;',
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals inside computed destructuring keys", async () => {
    await writeProjectFile(
      "resolvers/destructuring-computed-key.ts",
      ["const { [tailor.idp.Client]: value } = opts;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/destructuring-computed-key.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/destructuring-computed-key.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const { [tailor.idp.Client]: value } = opts;",
          }),
        ],
      }),
    ]);
  });

  test("reports wrapped runtime global roots", async () => {
    await writeProjectFile(
      "resolvers/wrapped-root.ts",
      [
        "const optional = tailor?.idp.Client;",
        "const nonNull = tailordb!.file.upload;",
        "const grouped = (tailor).workflow;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/wrapped-root.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/wrapped-root.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const optional = tailor?.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/wrapped-root.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const nonNull = tailordb!.file.upload;",
          }),
          expect.objectContaining({
            file: "resolvers/wrapped-root.ts",
            line: 3,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const grouped = (tailor).workflow;",
          }),
        ],
      }),
    ]);
  });

  test("reports casted runtime global roots", async () => {
    await writeProjectFile(
      "resolvers/casted-root.ts",
      [
        "const clientFactory = (tailor as any).idp.Client;",
        "const upload = (tailordb!).file.upload;",
        "const nonNullClientFactory = (tailor as any)!.idp.Client;",
        "const nonNullUpload = (tailordb as any)!.file.upload;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/casted-root.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/casted-root.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = (tailor as any).idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/casted-root.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const upload = (tailordb!).file.upload;",
          }),
          expect.objectContaining({
            file: "resolvers/casted-root.ts",
            line: 3,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const nonNullClientFactory = (tailor as any)!.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/casted-root.ts",
            line: 4,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const nonNullUpload = (tailordb as any)!.file.upload;",
          }),
        ],
      }),
    ]);
  });

  test("reports casted global object runtime global roots", async () => {
    await writeProjectFile(
      "resolvers/casted-global-object.ts",
      [
        "const clientFactory = (globalThis as any).tailor.idp.Client;",
        "const upload = (global as any).tailordb.file.upload;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/casted-global-object.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/casted-global-object.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = (globalThis as any).tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/casted-global-object.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const upload = (global as any).tailordb.file.upload;",
          }),
        ],
      }),
    ]);
  });

  test("reports wrapped global object runtime global roots", async () => {
    await writeProjectFile(
      "resolvers/wrapped-global-object.ts",
      [
        "const optional = globalThis?.tailor.idp.Client;",
        "const nonNull = globalThis!.tailor.idp.Client;",
        "const castOptional = (globalThis as any)?.tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/wrapped-global-object.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/wrapped-global-object.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const optional = globalThis?.tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/wrapped-global-object.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const nonNull = globalThis!.tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/wrapped-global-object.ts",
            line: 3,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const castOptional = (globalThis as any)?.tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals reached through globalThis", async () => {
    await writeProjectFile(
      "resolvers/global-this.ts",
      [
        "const clientFactory = globalThis.tailor.idp.Client;",
        "const errors = globalThis.TailorErrors;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/global-this.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/global-this.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = globalThis.tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/global-this.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const errors = globalThis.TailorErrors;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals reached through Node global", async () => {
    await writeProjectFile(
      "resolvers/global-object.ts",
      [
        "const clientFactory = global.tailor.idp.Client;",
        "const upload = global.tailordb.file.upload;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/global-object.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/global-object.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = global.tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/global-object.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const upload = global.tailordb.file.upload;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals inside for-in or for-of assignments", async () => {
    await writeProjectFile(
      "resolvers/for-assignment.ts",
      [
        "for (tailordb of sources) {",
        '  tailordb ["file"].upload;',
        "}",
        "for (tailor in sources) {",
        '  tailor ["idp"].Client;',
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/for-assignment.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/for-assignment.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'tailordb ["file"].upload;',
          }),
          expect.objectContaining({
            file: "resolvers/for-assignment.ts",
            line: 5,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'tailor ["idp"].Client;',
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals outside switch case bindings", async () => {
    await writeProjectFile(
      "resolvers/switch-case.ts",
      [
        "switch (kind) {",
        '  case "local":',
        "    const tailor = {};",
        "    break;",
        "}",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/switch-case.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/switch-case.ts",
            line: 6,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = tailor.idp.Client;",
          }),
        ],
      }),
    ]);
  });

  test("reports runtime globals inside array destructuring defaults", async () => {
    await writeProjectFile(
      "resolvers/array-default.ts",
      ["const [client = tailor.idp.Client] = opts;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/array-default.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/array-default.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const [client = tailor.idp.Client] = opts;",
          }),
        ],
      }),
    ]);
  });

  test("does not report local generic type parameters", async () => {
    await writeProjectFile(
      "resolvers/generic-type-parameters.ts",
      [
        "type Fn<TailorErrors> = (value: TailorErrors) => TailorErrors;",
        "interface Box<TailorErrorItem> {",
        "  value: TailorErrorItem;",
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports shorthand Tailor error globals left for manual migration", async () => {
    await writeProjectFile("errors.ts", ["const exported = { TailorErrors };", ""].join("\n"));

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["errors.ts"],
        findings: [
          expect.objectContaining({
            file: "errors.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const exported = { TailorErrors };",
          }),
        ],
      }),
    ]);
  });
});
