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

  test("reports direct runtime globals left after binding collisions", async () => {
    await writeProjectFile(
      "resolvers/create-user.ts",
      [
        "const idp = {};",
        'const client = new tailor.idp.Client({ namespace: "default" });',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["resolvers/create-user.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/create-user.ts",
            line: 2,
            message: expect.stringContaining("runtime global reference"),
            excerpt: 'const client = new tailor.idp.Client({ namespace: "default" });',
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

  test("reports embedded code strings that use runtime globals", async () => {
    await writeProjectFile(
      "seed/runtime-code.mjs",
      [
        'const code = "const client = new tailor.idp.Client();";',
        'const globalCode = "globalThis.tailor.idp.Client;";',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/runtime-globals-opt-in",
        files: ["seed/runtime-code.mjs"],
        findings: [
          expect.objectContaining({
            file: "seed/runtime-code.mjs",
            line: 1,
            message: expect.stringContaining("Embedded code string"),
            excerpt: 'const code = "const client = new tailor.idp.Client();";',
          }),
          expect.objectContaining({
            file: "seed/runtime-code.mjs",
            line: 2,
            message: expect.stringContaining("Embedded code string"),
            excerpt: 'const globalCode = "globalThis.tailor.idp.Client;";',
          }),
        ],
      }),
    ]);
  });

  test("does not add line findings for local bindings or prose strings", async () => {
    await writeProjectFile(
      "resolvers/local.ts",
      [
        "const tailor = { idp: { Client: class {} } };",
        "const client = new tailor.idp.Client();",
        'const note = "Please renew tailor.idp.Client credentials";',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews.flatMap((review) => review.findings ?? [])).toEqual([]);
  });
});
