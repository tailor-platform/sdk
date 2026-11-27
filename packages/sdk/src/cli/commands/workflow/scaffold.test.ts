import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { tailorArgv } from "#/cli/shared/test-helpers/process-argv";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { scaffoldCommand } from "./scaffold";

describe("workflow scaffold", () => {
  test("scaffolds a workflow whose main job starts a sub job, exported as a workflow", async () => {
    using tmp = tempCwd("sdk-workflow-scaffold-");
    using _logger = silenceLogger("info", "success", "warn");

    await runCommand(scaffoldCommand, ["workflows/order.ts"]);

    const file = fs.readFileSync(path.join(tmp.dir, "workflows/order.ts"), "utf-8");
    expect(file).toContain(
      'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";',
    );
    expect(file).toContain("sub.start(");
    expect(file).toContain("export default createWorkflow({");
    expect(file).toContain("mainJob: main");
    expect(file).toContain('name: "temporal-workflow"');
  });

  test("tells the user to run the scaffolded workflow with workflow run, without naming a job", async () => {
    using _tmp = tempCwd("sdk-workflow-scaffold-");
    using _success = silenceLogger("success", "warn");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await runCommand(scaffoldCommand, ["workflows/order.ts"]);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("tailor workflow run workflows/order.ts --arg"),
    );
    info.mockRestore();
  });

  test("keeps the env files it was given in the workflow run hint", async () => {
    using _tmp = tempCwd("sdk-workflow-scaffold-");
    using _success = silenceLogger("success", "warn");
    using _argv = tailorArgv(["workflow", "scaffold", "workflows/order.ts", "-e", ".env"]);
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await runCommand(scaffoldCommand, ["workflows/order.ts"]);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(`--env-file=${path.resolve(".env")}\``),
    );
    info.mockRestore();
  });

  test("refuses a path that does not end with .ts", async () => {
    using _tmp = tempCwd("sdk-workflow-scaffold-");
    using _logger = silenceLogger("info", "success", "warn");

    const result = await runCommand(scaffoldCommand, ["workflows/order.js"]);

    expect(result.error).toMatchObject({ code: "SCAFFOLD_PATH_INVALID" });
  });

  test("leaves a file that already exists untouched and says so", async () => {
    using tmp = tempCwd("sdk-workflow-scaffold-");
    using _logger = silenceLogger("info", "success", "warn");
    const file = path.join(tmp.dir, "workflows/order.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "// mine");

    const result = await runCommand(scaffoldCommand, ["workflows/order.ts"]);

    expect(result.error).toMatchObject({ code: "SCAFFOLD_FILE_EXISTS" });
    expect(fs.readFileSync(file, "utf-8")).toBe("// mine");
  });
});
