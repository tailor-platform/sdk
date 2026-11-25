import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { startWorkflow, startWorkflowByName } from "./start";

const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => "workspace-id"),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(async () => client.current),
}));

describe("workflow start with a workspace config", () => {
  let dir: string;
  let configPath: string;
  let mock: ReturnType<typeof workspaceClient>;

  function workspaceClient() {
    return mockOperatorClient({
      getWorkflowByName: { workflow: { id: "workflow-id", name: "close-books" } },
      startWorkflow: { executionId: "execution-id" },
    });
  }

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-start-")));
    configPath = writeWorkspaceProject(dir);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", undefined);
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "debug");
    mock = workspaceClient();
    client.current = mock;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const invokerOf = () => mock.startWorkflow.mock.calls[0]?.[0].authInvoker;

  test("starts as the Auth service that defines the machine user", async () => {
    await startWorkflowByName({ name: "close-books", machineUser: "seeder", configPath });

    expect(invokerOf()).toMatchObject({ namespace: "corp-auth", machineUserName: "seeder" });
  });

  test("starts as the Auth service a qualified machine user names", async () => {
    await startWorkflowByName({
      name: "close-books",
      machineUser: "partner-auth/admin",
      configPath,
    });

    expect(invokerOf()).toMatchObject({ namespace: "partner-auth", machineUserName: "admin" });
  });

  test("rejects a machine user name that several Auth services define", async () => {
    await expect(
      startWorkflowByName({ name: "close-books", machineUser: "admin", configPath }),
    ).rejects.toMatchObject({ code: "MACHINE_USER_AMBIGUOUS" });
    expect(mock.startWorkflow).not.toHaveBeenCalled();
  });

  test("starts a typed workflow as the invoker object's Auth service", async () => {
    await startWorkflow({
      workflow: { name: "close-books", mainJob: { body: () => undefined } },
      invoker: { namespace: "partner-auth", machineUserName: "admin" },
      configPath,
    });

    expect(invokerOf()).toMatchObject({ namespace: "partner-auth", machineUserName: "admin" });
  });
});
