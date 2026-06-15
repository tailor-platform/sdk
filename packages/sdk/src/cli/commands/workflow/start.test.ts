import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { captureStderr, captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { resolveWorkflow } from "./get";
import { startCommand, startWorkflow } from "./start";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("./get", () => ({
  resolveWorkflow: vi.fn(),
}));

describe("startWorkflow runtime overload", () => {
  let getApplicationMock: ReturnType<typeof vi.fn>;
  let testStartWorkflowMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
      },
    } as Awaited<ReturnType<typeof loadConfig>>);

    getApplicationMock = vi.fn().mockResolvedValue({
      application: {
        authNamespace: "auth-ns",
      },
    });
    testStartWorkflowMock = vi.fn().mockResolvedValue({
      executionId: "execution-1",
    });

    vi.mocked(initOperatorClient).mockResolvedValue({
      getApplication: getApplicationMock,
      testStartWorkflow: testStartWorkflowMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    vi.mocked(resolveWorkflow).mockImplementation(async (_client, _workspaceId, workflowName) => {
      return {
        id: `id:${workflowName}`,
      } as never;
    });
  });

  test("prefers legacy shape when name exists even if workflow key is present", async () => {
    await startWorkflow({
      name: "legacy-workflow",
      machineUser: "legacy-user",
      workflow: {
        name: "typed-workflow",
        mainJob: {
          body: () => undefined,
        },
      },
      authInvoker: "typed-user",
    } as never);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(resolveWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      "legacy-workflow",
    );

    expect(getApplicationMock).toHaveBeenCalledTimes(1);
    expect(testStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "id:legacy-workflow",
      }),
    );
  });

  test("typed shape resolves auth namespace from config and sends proto authInvoker", async () => {
    await startWorkflow({
      workflow: {
        name: "typed-workflow",
        mainJob: {
          body: () => undefined,
        },
      },
      authInvoker: "typed-user",
    });

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(getApplicationMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      applicationName: "my-app",
    });
    expect(testStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "id:typed-workflow",
        authInvoker: expect.objectContaining({
          namespace: "auth-ns",
          machineUserName: "typed-user",
        }),
      }),
    );
  });

  test("start command with jsonMode emits only parseable JSON to stdout", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(startCommand, ["legacy-workflow", "--machine-user", "legacy-user"]);

    expect(JSON.parse(stdout.output)).toEqual({ executionId: "execution-1" });
    expect(stderr.output).not.toBe("");
  });
});
