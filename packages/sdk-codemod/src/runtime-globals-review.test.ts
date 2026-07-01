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

  test("reports embedded code strings that start with runtime globals", async () => {
    await writeProjectFile(
      "seed/leading.mjs",
      [
        "const code = `tailor.idp.Client;`;",
        "const globalCode = `globalThis.tailor.idp.Client;`;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/leading.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/leading.mjs",
            line: 1,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const code = `tailor.idp.Client;`;",
          }),
          expect.objectContaining({
            file: "seed/leading.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const globalCode = `globalThis.tailor.idp.Client;`;",
          }),
        ],
      }),
    ]);
  });

  test("reports embedded code strings that alias bare runtime roots", async () => {
    await writeProjectFile(
      "seed/bare-root.mjs",
      [
        "const code = `const runtime = tailor;`;",
        "const dbCode = `const runtime = tailordb;`;",
        "const nonNullCode = `const runtime = tailor!;`;",
        "const castedCode = `const runtime = tailordb as any;`;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/bare-root.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/bare-root.mjs",
            line: 1,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const code = `const runtime = tailor;`;",
          }),
          expect.objectContaining({
            file: "seed/bare-root.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const dbCode = `const runtime = tailordb;`;",
          }),
          expect.objectContaining({
            file: "seed/bare-root.mjs",
            line: 3,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const nonNullCode = `const runtime = tailor!;`;",
          }),
          expect.objectContaining({
            file: "seed/bare-root.mjs",
            line: 4,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const castedCode = `const runtime = tailordb as any;`;",
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

  test("reports global object and casted runtime globals inside embedded code strings", async () => {
    await writeProjectFile(
      "seed/global-object-casted-root.mjs",
      [
        "const code = `",
        "const clientFactory = globalThis.tailor.idp.Client;",
        "const db = new (tailordb as any).Client();",
        "`;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/global-object-casted-root.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/global-object-casted-root.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const clientFactory = globalThis.tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "seed/global-object-casted-root.mjs",
            line: 3,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const db = new (tailordb as any).Client();",
          }),
        ],
      }),
    ]);
  });

  test("reports global object runtime root forms inside embedded code strings", async () => {
    await writeProjectFile(
      "seed/global-object-root-forms.mjs",
      [
        "const code = `",
        "const runtime = globalThis.tailor;",
        "const clientFactory = (globalThis as any).tailor.idp.Client;",
        "const bracketClient = globalThis['tailor'].idp.Client;",
        "`;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/global-object-root-forms.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/global-object-root-forms.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const runtime = globalThis.tailor;",
          }),
          expect.objectContaining({
            file: "seed/global-object-root-forms.mjs",
            line: 3,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const clientFactory = (globalThis as any).tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "seed/global-object-root-forms.mjs",
            line: 4,
            message: expect.stringContaining("Embedded code string"),
            excerpt: "const bracketClient = globalThis['tailor'].idp.Client;",
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

  test("reports bare aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/bare-runtime-root-alias.ts",
      ["const runtime = tailor;", "const clientFactory = runtime.idp.Client;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/bare-runtime-root-alias.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/bare-runtime-root-alias.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const runtime = tailor;",
          }),
        ],
      }),
    ]);
  });

  test("reports bare ambient runtime root references", async () => {
    await writeProjectFile(
      "resolvers/bare-runtime-root.ts",
      [
        "use(tailor);",
        "const opts = { runtime: tailordb };",
        "type Runtime = typeof tailor;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/bare-runtime-root.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/bare-runtime-root.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "use(tailor);",
          }),
          expect.objectContaining({
            file: "resolvers/bare-runtime-root.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const opts = { runtime: tailordb };",
          }),
          expect.objectContaining({
            file: "resolvers/bare-runtime-root.ts",
            line: 3,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "type Runtime = typeof tailor;",
          }),
        ],
      }),
    ]);
  });

  test("reports assignment targets that write ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/bare-runtime-root-assignment.ts",
      ["tailor = mockTailor;", "tailordb = mockDb;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/bare-runtime-root-assignment.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/bare-runtime-root-assignment.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "tailor = mockTailor;",
          }),
          expect.objectContaining({
            file: "resolvers/bare-runtime-root-assignment.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "tailordb = mockDb;",
          }),
        ],
      }),
    ]);
  });

  test("reports shorthand bare ambient runtime root references", async () => {
    await writeProjectFile(
      "resolvers/shorthand-bare-runtime-root.ts",
      ["const opts = { tailor, tailordb };", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/shorthand-bare-runtime-root.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/shorthand-bare-runtime-root.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const opts = { tailor, tailordb };",
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

  test("reports destructured aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-destructure.ts",
      ["const { tailor } = globalThis;", "const clientFactory = tailor.idp.Client;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-destructure.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-destructure.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const { tailor } = globalThis;",
          }),
        ],
      }),
    ]);
  });

  test("reports destructured aliases of casted ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-casted-destructure.ts",
      [
        "const { tailor } = globalThis as any;",
        "const { tailordb } = global!;",
        "const clientFactory = tailor.idp.Client;",
        "const upload = tailordb.file.upload;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-casted-destructure.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-casted-destructure.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const { tailor } = globalThis as any;",
          }),
          expect.objectContaining({
            file: "resolvers/runtime-root-casted-destructure.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const { tailordb } = global!;",
          }),
        ],
      }),
    ]);
  });

  test("reports destructured aliases of non-null casted ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-non-null-casted-destructure.ts",
      [
        "const { tailor } = (globalThis as any)!;",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-non-null-casted-destructure.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-non-null-casted-destructure.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const { tailor } = (globalThis as any)!;",
          }),
        ],
      }),
    ]);
  });

  test("reports destructuring assignment aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-destructure-assignment.ts",
      [
        "let tailor;",
        "({ tailor } = globalThis);",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-destructure-assignment.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-destructure-assignment.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "({ tailor } = globalThis);",
          }),
        ],
      }),
    ]);
  });

  test("reports destructuring assignments that write ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-destructure-assignment-target.ts",
      ["[tailor = fallback] = values;", "({ x: tailordb = fallback } = row);", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-destructure-assignment-target.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-destructure-assignment-target.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "[tailor = fallback] = values;",
          }),
          expect.objectContaining({
            file: "resolvers/runtime-root-destructure-assignment-target.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "({ x: tailordb = fallback } = row);",
          }),
        ],
      }),
    ]);
  });

  test("reports destructured aliases of parenthesized casted ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-parenthesized-casted-destructure.ts",
      [
        "const { tailor } = ((globalThis) as any);",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-parenthesized-casted-destructure.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-parenthesized-casted-destructure.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const { tailor } = ((globalThis) as any);",
          }),
        ],
      }),
    ]);
  });

  test("reports destructured parameter defaults of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-parameter-default-destructure.ts",
      ["function run({ tailor } = globalThis) {", "  return tailor.idp.Client;", "}", ""].join(
        "\n",
      ),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-parameter-default-destructure.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-parameter-default-destructure.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "function run({ tailor } = globalThis) {",
          }),
        ],
      }),
    ]);
  });

  test("reports grouped casted runtime roots", async () => {
    await writeProjectFile(
      "resolvers/grouped-casted-root.ts",
      [
        "const clientFactory = ((tailor as any)).idp.Client;",
        "const runtime = ((globalThis as any)).tailor;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/grouped-casted-root.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/grouped-casted-root.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = ((tailor as any)).idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/grouped-casted-root.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const runtime = ((globalThis as any)).tailor;",
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

  test("reports parenthesized casted aliases of ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/runtime-root-parenthesized-casted-alias.ts",
      [
        "const runtime = ((globalThis) as any).tailor;",
        "const clientFactory = runtime.idp.Client;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/runtime-root-parenthesized-casted-alias.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/runtime-root-parenthesized-casted-alias.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const runtime = ((globalThis) as any).tailor;",
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

  test("reports indexed type query runtime globals", async () => {
    await writeProjectFile(
      "resolvers/indexed-type-query.ts",
      ["type Idp = typeof tailor['idp'];", "type Client = (typeof tailordb)['Client'];", ""].join(
        "\n",
      ),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/indexed-type-query.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/indexed-type-query.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "type Idp = typeof tailor['idp'];",
          }),
          expect.objectContaining({
            file: "resolvers/indexed-type-query.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "type Client = (typeof tailordb)['Client'];",
          }),
        ],
      }),
    ]);
  });

  test("reports indexed global object type query runtime globals", async () => {
    await writeProjectFile(
      "resolvers/indexed-global-type-query.ts",
      [
        'type Tailor = typeof globalThis["tailor"];',
        'type Tailordb = (typeof global)["tailordb"];',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/indexed-global-type-query.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/indexed-global-type-query.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'type Tailor = typeof globalThis["tailor"];',
          }),
          expect.objectContaining({
            file: "resolvers/indexed-global-type-query.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'type Tailordb = (typeof global)["tailordb"];',
          }),
        ],
      }),
    ]);
  });

  test("reports dynamic indexed type query runtime globals", async () => {
    await writeProjectFile(
      "resolvers/dynamic-indexed-type-query.ts",
      ["type Key = 'idp';", "type Idp = typeof tailor[Key];", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/dynamic-indexed-type-query.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/dynamic-indexed-type-query.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "type Idp = typeof tailor[Key];",
          }),
        ],
      }),
    ]);
  });

  test("does not report indexed type accesses on local type bindings", async () => {
    await writeProjectFile(
      "resolvers/local-indexed-type-access.ts",
      [
        'import type * as tailordb from "./types";',
        "type ImportedClient = tailordb['Client'];",
        "type GenericClient<tailor> = tailor['idp'];",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
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
      [
        'throw new Error("Please renew tailor.idp.Client credentials");',
        'console.log("tailor.idp.Client credentials");',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report runtime-looking names inside string data", async () => {
    await writeProjectFile(
      "resolvers/string-data.ts",
      ['const names = ["TailorErrors", "TailorErrorItem", "tailor", "tailordb"];', ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report runtime-looking string keys or module specifiers", async () => {
    await writeProjectFile(
      "resolvers/string-keys.ts",
      [
        'import value from "tailor.idp";',
        'export { value as exported } from "tailordb.file";',
        'const dynamic = await import("tailor.idp");',
        'const subscript = other["tailor.idp"];',
        'const object = { "tailor.idp": 1, "tailordb.file": 2 };',
        'const computed = { ["tailor.idp.Client"]: 1 };',
        "",
      ].join("\n"),
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

  test("does not report plain local bindings initialized from global objects", async () => {
    await writeProjectFile(
      "resolvers/plain-global-binding.ts",
      ["const tailor = globalThis;", "let tailordb;", "tailordb = global;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report nested runtime-looking destructures from global objects", async () => {
    await writeProjectFile(
      "resolvers/nested-global-destructure.ts",
      [
        "const { nested: { tailor } } = globalThis;",
        "const clientFactory = tailor.idp.Client;",
        "",
      ].join("\n"),
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

  test("does not report runtime-looking qualified type members", async () => {
    await writeProjectFile(
      "resolvers/qualified-type-member.ts",
      ["type RuntimeError = Foo.TailorErrors;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("does not report infer or mapped runtime-looking type parameters", async () => {
    await writeProjectFile(
      "resolvers/local-type-parameter-forms.ts",
      [
        "type Inferred<T> = T extends infer TailorErrors ? TailorErrors : never;",
        "type NestedInferred<T> = T extends Promise<infer TailorErrorItem> ? TailorErrorItem : never;",
        "type Mapped<T> = { [TailorErrorItem in keyof T]: T[TailorErrorItem] };",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });

  test("reports ambient runtime error types outside infer binding branches", async () => {
    await writeProjectFile(
      "resolvers/infer-false-branch-runtime-type.ts",
      ["type Inferred<T> = T extends infer TailorErrors ? string : TailorErrors;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/infer-false-branch-runtime-type.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/infer-false-branch-runtime-type.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "type Inferred<T> = T extends infer TailorErrors ? string : TailorErrors;",
          }),
        ],
      }),
    ]);
  });

  test("does not report names imported inside declaration scopes", async () => {
    await writeProjectFile(
      "types/ambient-module.d.ts",
      [
        'declare module "pkg" {',
        '  import type * as tailor from "./types";',
        "  type User = tailor.idp.User;",
        "}",
        "",
      ].join("\n"),
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

  test("does not report self-named class expressions", async () => {
    await writeProjectFile(
      "resolvers/self-named-class.ts",
      [
        "const Local = class tailor {",
        "  static getClient() {",
        "    return tailor.idp.Client;",
        "  }",
        "};",
        "",
      ].join("\n"),
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

  test("does not report local legacy module runtime-looking bindings", async () => {
    await writeProjectFile(
      "resolvers/local-legacy-module.d.ts",
      ["module tailordb {", "  export interface Client {}", "}", "type X = tailordb.Client;"].join(
        "\n",
      ),
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

  test("does not report namespace re-export aliases", async () => {
    await writeProjectFile(
      "resolvers/export-namespace.ts",
      [
        'export * as tailor from "./runtime";',
        'export type * as TailorErrors from "./types";',
        "",
      ].join("\n"),
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

  test("reports for-loop assignments that write ambient runtime roots", async () => {
    await writeProjectFile(
      "resolvers/for-assignment-target.ts",
      ["for (tailor of sources) {}", "for (tailordb in sources) {}", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/for-assignment-target.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/for-assignment-target.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "for (tailor of sources) {}",
          }),
          expect.objectContaining({
            file: "resolvers/for-assignment-target.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "for (tailordb in sources) {}",
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

  test("does not report hoisted var for-loop runtime-looking bindings", async () => {
    await writeProjectFile(
      "resolvers/hoisted-for-var.ts",
      [
        "function run() {",
        "  for (var tailor of sources) {}",
        "  tailor.idp.Client;",
        "  for (var tailordb in sources) {}",
        "  tailordb.file.upload;",
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

  test("reports runtime globals inside custom-element self-closing JSX in js files", async () => {
    await writeProjectFile(
      "components/custom-element.js",
      ["export const view = <my-element value={tailor.idp.Client} />;", ""].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["components/custom-element.js"],
        findings: [
          expect.objectContaining({
            file: "components/custom-element.js",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "export const view = <my-element value={tailor.idp.Client} />;",
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
        "const spaced = globalThis . tailor.idp.Client;",
        "const groupedSpaced = (global) . TailorErrors;",
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
          expect.objectContaining({
            file: "resolvers/wrapped-global-object.ts",
            line: 4,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const spaced = globalThis . tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/wrapped-global-object.ts",
            line: 5,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const groupedSpaced = (global) . TailorErrors;",
          }),
        ],
      }),
    ]);
  });

  test("reports commented global object runtime global roots", async () => {
    await writeProjectFile(
      "resolvers/commented-global-object.ts",
      [
        "const clientFactory = globalThis/* comment */.tailor.idp.Client;",
        "const runtime = (globalThis /* comment */).tailor;",
        "const lineClientFactory = globalThis // comment",
        "  .tailor.idp.Client;",
        "const lineRuntime = global // comment",
        '  ["tailor"];',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/commented-global-object.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/commented-global-object.ts",
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const clientFactory = globalThis/* comment */.tailor.idp.Client;",
          }),
          expect.objectContaining({
            file: "resolvers/commented-global-object.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const runtime = (globalThis /* comment */).tailor;",
          }),
          expect.objectContaining({
            file: "resolvers/commented-global-object.ts",
            line: 3,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const lineClientFactory = globalThis // comment",
          }),
          expect.objectContaining({
            file: "resolvers/commented-global-object.ts",
            line: 5,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "const lineRuntime = global // comment",
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
            line: 1,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "for (tailordb of sources) {",
          }),
          expect.objectContaining({
            file: "resolvers/for-assignment.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'tailordb ["file"].upload;',
          }),
          expect.objectContaining({
            file: "resolvers/for-assignment.ts",
            line: 4,
            message: expect.stringContaining("runtime global reference"),
            excerpt: "for (tailor in sources) {",
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
