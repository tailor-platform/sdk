import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { runCodemods } from "./runner";
import { runnableCodemod } from "./test-helpers/codemods";

const entry = runnableCodemod("v3/function-test-run-rename");

async function run(relativePath: string, source: string) {
  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "function-test-run-"));
  try {
    const file = path.join(projectDir, relativePath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, source, "utf-8");
    const result = await runCodemods([entry], projectDir, false);
    return { result, output: await fs.promises.readFile(file, "utf-8") };
  } finally {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  }
}

describe("function test-run rename", () => {
  test.each([
    ["tailor function --json test-run a.ts\n", "tailor function --json run a.ts\n"],
    ["tailor --json function test-run a.ts\n", "tailor --json function run a.ts\n"],
  ])("rewrites %j and leaves nothing to warn about", async (source, expected) => {
    const { result, output } = await run("run.sh", source);

    expect(output).toBe(expected);
    expect(result.warnings).toEqual([]);
  });

  test.each([
    ["a package runner", "npx @tailor-platform/sdk function test-run a.ts\n"],
    [
      "a package runner with a global option before function",
      "npx @tailor-platform/sdk --json function test-run a.ts\n",
    ],
    [
      "a package runner with a global option after function",
      "npx @tailor-platform/sdk function --json test-run a.ts\n",
    ],
    [
      "a global option that takes a value after function",
      "npx @tailor-platform/sdk function -e .env test-run a.ts\n",
    ],
  ])("warns when %s still names test-run after the rewrite", async (_name, source) => {
    const { result, output } = await run("run.sh", source);

    expect(output).toBe(source);
    expect(result.warnings).toEqual([
      expect.stringContaining("was not migrated automatically (rule: v3/function-test-run-rename)"),
    ]);
  });

  test.each([
    [
      "a short option and its value",
      "spawn('tailor', ['function', '-e', '.env', 'test-run', 'a.ts']);\n",
    ],
    [
      "a long option and its value",
      "spawn('tailor', ['function', '--env-file', '.env', 'test-run', 'a.ts']);\n",
    ],
    ["a flag", "spawn('tailor', ['function', '--json', 'test-run', 'a.ts']);\n"],
  ])("warns about an argv array with %s before test-run", async (_name, source) => {
    const { result, output } = await run("run.ts", source);

    expect(output).toBe(source);
    expect(result.warnings).toEqual([
      expect.stringContaining("was not migrated automatically (rule: v3/function-test-run-rename)"),
    ]);
  });
});
