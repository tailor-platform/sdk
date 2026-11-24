import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { scriptCommand } from "./script";
import { SCRIPT_SNAPSHOT_FILE_NAME } from "./script-scaffold";

describe("function script with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-script-")));
    configPath = writeWorkspaceProject(dir);
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "debug");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("scaffolds a script from the local tables of a namespace no application lists", async () => {
    const scriptPath = path.join(dir, "scripts", "fix.ts");

    const result = await runCommand(scriptCommand, [
      scriptPath,
      "--config",
      configPath,
      "--namespace",
      "ledger-db",
    ]);

    expect(result.error).toBeUndefined();
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(dir, "scripts", SCRIPT_SNAPSHOT_FILE_NAME), "utf-8"),
    );
    expect(snapshot.namespace).toBe("ledger-db");
    expect(Object.keys(snapshot.tables)).toEqual(["Entry"]);
  });
});
