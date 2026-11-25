import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadSeedContext } from "./seed-context";
import { silenceLogger } from "./test-helpers/silence-logger";
import { writeWorkspaceProject } from "./test-helpers/workspace-config";

describe("loadSeedContext with a workspace config", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-seed-")));
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "debug");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("seeds every namespace and resolves machine users across the Auth services", async () => {
    const configPath = writeWorkspaceProject(dir, {
      plugins: 'seedPlugin({ distPath: "./seed", machineUserName: "seeder" })',
    });

    const context = await loadSeedContext({ configPath });

    expect(context.namespaces.map(({ namespace }) => namespace)).toEqual([
      "customer-db",
      "order-db",
      "ledger-db",
    ]);
    expect(context.machineUserName).toBe("seeder");
    expect(context.resolveMachineUser?.("seeder")).toEqual({
      namespace: "corp-auth",
      machineUserName: "seeder",
    });
    expect(() => context.resolveMachineUser?.("admin")).toThrow(
      expect.objectContaining({ code: "MACHINE_USER_AMBIGUOUS" }),
    );
    expect(context.appName).toBeUndefined();
  });

  test("reads a machine user given with its Auth service as <auth>/<name>", async () => {
    const configPath = writeWorkspaceProject(dir, {
      plugins:
        'seedPlugin({ distPath: "./seed", machineUserName: { namespace: "partner-auth", machineUserName: "admin" } })',
    });

    const context = await loadSeedContext({ configPath });

    expect(context.machineUserName).toBe("partner-auth/admin");
    expect(context.resolveMachineUser?.("partner-auth/admin")).toEqual({
      namespace: "partner-auth",
      machineUserName: "admin",
    });
  });
});
