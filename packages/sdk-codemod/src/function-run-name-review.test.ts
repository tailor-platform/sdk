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
    ["a Windows path before --name", "run.cmd", "tailor function run C:\\proj\\a.ts --name x\r\n"],
    ["a quoted argument holding a separator", "run.sh", 'tailor function run "a;b.ts" --name x\n'],
    [
      "a quoted argument before --name in a package.json script",
      "package.json",
      JSON.stringify({ scripts: { job: 'tailor function run "a b.ts" --name x' } }),
    ],
    [
      "a JSON argument before --name in a package.json script",
      "package.json",
      JSON.stringify({ scripts: { job: `tailor function run a.ts --arg '{"n":1}' --name x` } }),
    ],
    [
      "a Windows path before --name in a package.json script",
      "package.json",
      JSON.stringify({ scripts: { job: "tailor function run C:\\proj\\a.ts --name x" } }),
    ],
    [
      "--name after a PowerShell backtick continuation",
      "run.ps1",
      "tailor function run a.ts `\n  --name x\n",
    ],
    [
      "--name after a cmd caret continuation",
      "run.cmd",
      "tailor function run a.ts ^\r\n  --name x\r\n",
    ],
    [
      "--name on its own line of a folded YAML scalar",
      ".github/workflows/job.yml",
      "steps:\n  - run: >-\n      tailor function run a.ts\n      --name x\n",
    ],
    [
      "an argv array passed to a process call",
      "run.ts",
      'spawnSync("tailor", ["function", "run", "a.ts", "--name", "x"]);\n',
    ],
    [
      "an argv array held in a variable",
      "run.ts",
      'const argv = ["tailor", "function", "run", "a.ts", "--name", "x"];\n',
    ],
  ])("reports %s", async (_name, relativePath, source) => {
    expect(await reportedFiles(relativePath, source)).toEqual([relativePath]);
  });

  test.each([
    ["a function run without --name", "run.sh", "tailor function run a.ts --arg '{}'\n"],
    ["--name of another command", "run.sh", "tailor workspace create --name my-app\n"],
    [
      "--name of another command chained after function run with &&",
      "run.sh",
      "tailor function run a.ts && tailor workspace create --name my-app\n",
    ],
    [
      "--name of another command chained after function run with ;",
      "run.sh",
      "tailor function run a.ts; tailor workspace create --name my-app\n",
    ],
    [
      "--name of another command piped from function run",
      "run.sh",
      "tailor function run a.ts | tailor workspace create --name my-app\n",
    ],
    [
      "--name text inside a single-quoted argument",
      "run.sh",
      `tailor function run a.ts --arg '{"text":" --name example"}'\n`,
    ],
    [
      "--name text inside a double-quoted argument",
      "run.sh",
      'tailor function run a.ts --arg "text --name example"\n',
    ],
    [
      "a line of many escaped quotes without --name, without taking exponential time",
      "run.sh",
      `tailor function run ${String.raw`\"`.repeat(20000)}\n`,
    ],
    [
      "--name of another command in a separate string of a TypeScript file",
      "run.ts",
      'const a = "tailor function run a.ts"; const b = "tailor workspace create --name app";\n',
    ],
    [
      "--name of another command inside a shell function named run",
      "run.sh",
      "function run() { tailor workspace create --name app; }\n",
    ],
    [
      "--name of another command inside a shell function named run, declared without parentheses",
      "run.sh",
      "function run { tailor workspace create --name app; }\n",
    ],
    [
      "--name of another command on the next line of a shell script",
      "run.sh",
      "tailor function run a.ts\ntailor workspace create --name app\n",
    ],
    [
      "--name text inside an argument in a package.json script",
      "package.json",
      JSON.stringify({
        scripts: { job: `tailor function run a.ts --arg '{"text":" --name example"}'` },
      }),
    ],
    [
      "--name of another command in an argv array",
      "run.ts",
      'spawnSync("tailor", ["workspace", "create", "--name", "app"]);\n',
    ],
    [
      "--name of another command in an argv array next to a function run array",
      "run.ts",
      'spawnSync("tailor", ["function", "run", "a.ts"]); spawnSync("tailor", ["workspace", "create", "--name", "app"]);\n',
    ],
  ])("does not report %s", async (_name, relativePath, source) => {
    expect(await reportedFiles(relativePath, source)).toEqual([]);
  });
});
