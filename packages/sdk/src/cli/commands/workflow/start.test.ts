import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { captureStderr, captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { resolveWorkflow } from "./get";
import { startCommand, startWorkflow } from "./start";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn<MockProcedure>(),
  loadWorkspaceId: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn<MockProcedure>(),
}));

vi.mock("./get", () => ({
  resolveWorkflow: vi.fn<MockProcedure>(),
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

    getApplicationMock = vi.fn<MockProcedure>().mockResolvedValue({
      application: {
        authNamespace: "auth-ns",
      },
    });
    testStartWorkflowMock = vi.fn<MockProcedure>().mockResolvedValue({
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
      authInvoker: {
        namespace: "typed-ns",
        machineUserName: "typed-user",
      },
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

  test("start command with jsonMode emits only parseable JSON to stdout", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(startCommand, ["legacy-workflow", "--machine-user", "legacy-user"]);

    expect(JSON.parse(stdout.output)).toEqual({ executionId: "execution-1" });
    expect(stderr.output).not.toBe("");
  });
});
