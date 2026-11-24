import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { runCodemods } from "./runner";
import { runnableCodemod } from "./test-helpers/codemods";

const entry = runnableCodemod("v3/function-script-rename");

async function run(relativePath: string, source: string) {
  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "function-script-rename-"));
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

describe("function script rename", () => {
  test("rewrites a tailor invocation and leaves nothing to warn about", async () => {
    const { result, output } = await run("run.sh", "tailor function script scripts/fix.ts\n");

    expect(output).toBe("tailor function scaffold scripts/fix.ts\n");
    expect(result.warnings).toEqual([]);
  });

  test.each([
    ["a package runner", "README.md", "Run `npx @tailor-platform/sdk function script a.ts`.\n"],
    ["a pinned package runner", "run.sh", "npx @tailor-platform/sdk@2.46.0 function script a.ts\n"],
  ])("warns when %s still names function script after the rewrite", async (_name, file, source) => {
    const { result, output } = await run(file, source);

    expect(output).toBe(source);
    expect(result.warnings).toEqual([
      expect.stringContaining("was not migrated automatically (rule: v3/function-script-rename)"),
    ]);
  });

  test.each([
    ["a function declaration named script", "run.ts", "function script() {}\nscript();\n"],
    ["prose that names the subcommand", "README.md", "The function script runs once.\n"],
    ["tailordb migrate script", "run.sh", "tailor tailordb migrate script\n"],
    ["workflow scaffold", "run.sh", "tailor workflow scaffold flow.ts\n"],
    ["another binary", "run.sh", "custom-tailor function script a.ts\n"],
    ["a file named script.ts", "run.sh", "tailor function run script.ts\n"],
  ])("neither rewrites nor warns about %s", async (_name, file, source) => {
    const { result, output } = await run(file, source);

    expect(output).toBe(source);
    expect(result.warnings).toEqual([]);
  });
});
