import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeScriptReportingStart } from "#/cli/shared/script-executor";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { runFunctionCommand } from "./run";

const MACHINE_USERS: Record<string, string[]> = {
  "corp-auth": ["admin", "seeder"],
  "partner-auth": ["admin"],
};

const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => "12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(async () => client.current),
}));

vi.mock("#/cli/shared/script-executor", () => ({
  executeScriptReportingStart: vi.fn(async () => ({ success: true, logs: "", result: "{}" })),
}));

describe("function run with a workspace config", () => {
  let dir: string;
  let configPath: string;
  let scriptPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-run-")));
    configPath = writeWorkspaceProject(dir);
    scriptPath = path.join(dir, "fn.js");
    fs.writeFileSync(scriptPath, "export default async function main() { return {}; }");
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", undefined);
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "debug", "error");
    client.current = mockOperatorClient({
      getAuthMachineUser: async ({ authNamespace, name }) => {
        if (!MACHINE_USERS[authNamespace ?? ""]?.includes(name ?? "")) {
          throw new ConnectError("machine user not found", Code.NotFound);
        }
        return { machineUser: { id: `${authNamespace}-${name}`, name } };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (...argv: string[]) =>
    runCommand(runFunctionCommand, [scriptPath, "--config", configPath, ...argv]);

  test("runs as the Auth service that defines the machine user", async () => {
    const result = await run("--machine-user", "seeder");

    expect(result.error).toBeUndefined();
    expect(executeScriptReportingStart).toHaveBeenCalledWith(
      expect.objectContaining({
        invoker: expect.objectContaining({ namespace: "corp-auth", machineUserName: "seeder" }),
      }),
    );
  });

  test("runs as the Auth service a qualified machine user names", async () => {
    await run("--machine-user", "partner-auth/admin");

    expect(executeScriptReportingStart).toHaveBeenCalledWith(
      expect.objectContaining({
        invoker: expect.objectContaining({ namespace: "partner-auth", machineUserName: "admin" }),
      }),
    );
  });

  test("rejects a machine user name that several Auth services define", async () => {
    const result = await run("--machine-user", "admin");

    expect(result.error).toMatchObject({ code: "MACHINE_USER_AMBIGUOUS" });
    expect(executeScriptReportingStart).not.toHaveBeenCalled();
  });

  test("needs a machine user when several Auth services could provide one", async () => {
    const result = await run();

    expect(result.error).toMatchObject({ code: "MACHINE_USER_REQUIRED" });
  });
});
