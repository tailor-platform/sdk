import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "#/cli/shared/config-loader";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { scriptCommand } from "./script";

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

const kyselyPluginStub = {
  id: "@tailor-platform/kysely-type",
  description: "stub",
  pluginConfig: { distPath: "./generated/tailordb.ts" },
};

function mockConfig(dir: string): void {
  vi.mocked(loadConfig).mockResolvedValue({
    config: { path: path.join(dir, "tailor.config.ts"), db: { tailordb: {} } },
    plugins: [kyselyPluginStub],
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

describe("workflow script", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReset();
  });

  test("scaffolds a script that returns where it stopped so that it can be run again from there", async () => {
    using tmp = tempCwd("sdk-workflow-script-");
    using _logger = silenceLogger("info", "success", "warn");
    mockConfig(tmp.dir);

    await runCommand(scriptCommand, ["scripts/backfill.ts", "--namespace", "tailordb"]);

    const script = fs.readFileSync(path.join(tmp.dir, "scripts/backfill.ts"), "utf-8");
    expect(script).toContain("export default async function main(arg: Arg = {})");
    expect(script).toContain("return { done: true }");
    expect(script).toContain("return { done: false, next: { after } }");
    expect(script).toContain('import { getDB } from "../generated/tailordb";');
    expect(script).toContain("tailor workflow run <this file>");
  });

  test("tells the user to run the scaffolded script with workflow run", async () => {
    using tmp = tempCwd("sdk-workflow-script-");
    using _success = silenceLogger("success", "warn");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    mockConfig(tmp.dir);

    await runCommand(scriptCommand, ["scripts/backfill.ts", "--namespace", "tailordb"]);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("tailor workflow run scripts/backfill.ts"),
    );
    info.mockRestore();
  });
});
