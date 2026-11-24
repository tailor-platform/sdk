import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";

const codemod = allCodemods.find((entry) => entry.id === "v3/function-run-name-to-workflow-run")!;

async function reportedFiles(relativePath: string, source: string): Promise<string[]> {
  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "function-run-name-"));
  try {
    const file = path.join(projectDir, relativePath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, source, "utf-8");
    const result = await runCodemods([{ codemod }], projectDir, true);
    return result.llmReviews.flatMap((review) => review.files);
  } finally {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  }
}

describe("function run --name review", () => {
  test.each([
    ["a shell script", "run.sh", "tailor function run a.ts --name validate-order\n"],
    ["the test-run alias", "run.sh", "tailor function test-run a.ts --name validate-order\n"],
    ["the -n alias", "run.sh", "tailor function run a.ts -n validate-order\n"],
    [
      "a package.json script",
      "package.json",
      '{"scripts":{"job":"tailor function run a.ts --name validate-order"}}\n',
    ],
    [
      "a GitHub Actions step",
      ".github/workflows/job.yml",
      "steps:\n  - run: tailor function run a.ts --name validate-order\n",
    ],
    [
      "a command in a string of a TypeScript file",
      "run.ts",
      'execSync("tailor function run a.ts --name validate-order");\n',
    ],
    [
      "--name on the line after a line continuation",
      "run.sh",
      "tailor function run a.ts \\\n  --name validate-order\n",
    ],
    [
      "a global option between function and run",
      "run.sh",
      "tailor function --verbose run a.ts --name validate-order\n",
    ],
  ])("reports %s", async (_name, relativePath, source) => {
    expect(await reportedFiles(relativePath, source)).toEqual([relativePath]);
  });

  test.each([
    ["a function run without --name", "tailor function run a.ts --arg '{}'\n"],
    ["--name of another command", "tailor workspace create --name my-app\n"],
    [
      "--name of another command chained after function run with &&",
      "tailor function run a.ts && tailor workspace create --name my-app\n",
    ],
    [
      "--name of another command chained after function run with ;",
      "tailor function run a.ts; tailor workspace create --name my-app\n",
    ],
    [
      "--name of another command piped from function run",
      "tailor function run a.ts | tailor workspace create --name my-app\n",
    ],
  ])("does not report %s", async (_name, source) => {
    expect(await reportedFiles("run.sh", source)).toEqual([]);
  });
});
