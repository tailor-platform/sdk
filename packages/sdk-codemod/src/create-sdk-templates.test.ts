import * as fs from "node:fs";
import * as os from "node:os";
import { createPatch, OMIT_HEADERS } from "diff";
import * as path from "pathe";
import { inc, major } from "semver";
import { aroundEach, describe, expect, test } from "vitest";
import { allCodemods, NEXT_RELEASE } from "./registry";
import { runCodemods } from "./runner";
import { transformSourcePath } from "./test-helpers/codemods";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "packages/create-sdk/templates");

const templateNames = fs
  .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && fs.existsSync(path.join(TEMPLATES_DIR, entry.name, "package.json")),
  )
  .map((entry) => entry.name);

const sdkVersion: string = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "packages/sdk/package.json"), "utf-8"),
).version;
const nextMajor = major(inc(sdkVersion, "major")!);

const codemods = allCodemods
  .filter((codemod) => codemod.until !== NEXT_RELEASE && major(codemod.until) === nextMajor)
  .map((codemod) => ({
    codemod,
    scriptPath: codemod.scriptPath && transformSourcePath(codemod.scriptPath),
  }));

describe.skipIf(codemods.length === 0)("next-major codemods on create-sdk templates", () => {
  let projectDir: string;

  aroundEach(async (runTest) => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "create-sdk-template-"));
    try {
      await runTest();
    } finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    }
  });

  test.each(templateNames)("%s", async (template) => {
    const templateDir = path.join(TEMPLATES_DIR, template);
    await fs.promises.cp(templateDir, projectDir, {
      recursive: true,
      filter: (source) => path.basename(source) !== "node_modules",
    });

    const result = await runCodemods(codemods, projectDir, false);

    const diffs = Object.fromEntries(
      result.filesModified
        .map((file) => path.relative(projectDir, file))
        .toSorted()
        .map((file) => [
          file,
          createPatch(
            file,
            fs.readFileSync(path.join(templateDir, file), "utf-8"),
            fs.readFileSync(path.join(projectDir, file), "utf-8"),
            undefined,
            undefined,
            { headerOptions: OMIT_HEADERS },
          ),
        ]),
    );
    expect({
      diffs,
      warnings: result.warnings.toSorted(),
      llmReviews: result.llmReviews.map(({ prompt: _prompt, ...review }) => review),
    }).toMatchSnapshot();
  });
});
