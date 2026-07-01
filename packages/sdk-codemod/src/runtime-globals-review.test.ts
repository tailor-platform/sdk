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

  test("does not report prose-only runtime global mentions inside strings", async () => {
    await writeProjectFile(
      "seed/prose.mjs",
      [
        'console.log("Truncating _User via tailor.idp.Client before reseeding");',
        'console.log("Use the migration guide before changing runtime globals");',
        "",
      ].join("\n"),
    );

    const result = await runCodemods([runtimeGlobalsEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });
});
