import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { scriptCommand } from "./script";

describe("workflow script", () => {
  test("scaffolds a workflow whose main job starts another job, exported as a workflow", async () => {
    using tmp = tempCwd("sdk-workflow-script-");
    using _logger = silenceLogger("info", "success", "warn");

    await runCommand(scriptCommand, ["workflows/order.ts"]);

    const file = fs.readFileSync(path.join(tmp.dir, "workflows/order.ts"), "utf-8");
    expect(file).toContain(
      'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";',
    );
    expect(file).toContain("processItem.start(");
    expect(file).toContain("export default createWorkflow({");
    expect(file).toContain("mainJob: processAll");
  });

  test("tells the user to run the scaffolded workflow from its main job with workflow run", async () => {
    using _tmp = tempCwd("sdk-workflow-script-");
    using _success = silenceLogger("success", "warn");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await runCommand(scriptCommand, ["workflows/order.ts"]);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("tailor workflow run workflows/order.ts --job process-all"),
    );
    info.mockRestore();
  });

  test("refuses a path that does not end with .ts", async () => {
    using _tmp = tempCwd("sdk-workflow-script-");
    using _logger = silenceLogger("info", "success", "warn");

    const result = await runCommand(scriptCommand, ["workflows/order.js"]);

    expect(result.error).toMatchObject({ code: "SCRIPT_PATH_INVALID" });
  });

  test("leaves a file that already exists untouched and says so", async () => {
    using tmp = tempCwd("sdk-workflow-script-");
    using _logger = silenceLogger("info", "success", "warn");
    const file = path.join(tmp.dir, "workflows/order.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "// mine");

    const result = await runCommand(scriptCommand, ["workflows/order.ts"]);

    expect(result.error).toMatchObject({ code: "SCRIPT_FILE_EXISTS" });
    expect(fs.readFileSync(file, "utf-8")).toBe("// mine");
  });
});
