import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadMachineUserName, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resolveWorkflow } from "./get";
import { startCommand, startWorkflow } from "./start";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
  loadMachineUserName: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("./get", () => ({
  resolveWorkflow: vi.fn(),
}));

describe("startWorkflow runtime overload", () => {
  let getApplicationMock: ReturnType<typeof vi.fn>;
  let getWorkflowExecutionMock: ReturnType<typeof vi.fn>;
  let testStartWorkflowMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadMachineUserName).mockResolvedValue("legacy-user");
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
    getWorkflowExecutionMock = vi.fn().mockResolvedValue({
      execution: {
        id: "execution-1",
        workflowName: "legacy-workflow",
        status: WorkflowExecution_Status.SUCCESS,
        jobExecutions: [],
      } as unknown as WorkflowExecution,
    });

    vi.mocked(initOperatorClient).mockResolvedValue({
      getApplication: getApplicationMock,
      getWorkflowExecution: getWorkflowExecutionMock,
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

  test("start command wait with jsonMode emits only parseable JSON to stdout", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(startCommand, [
      "legacy-workflow",
      "--machine-user",
      "legacy-user",
      "--wait",
      "--until",
      "success",
      "--timeout",
      "1s",
      "--interval",
      "1ms",
    ]);

    expect(JSON.parse(stdout.output)).toMatchObject({
      id: "execution-1",
      workflowName: "legacy-workflow",
      status: "SUCCESS",
      statusClass: "success",
      attempts: 1,
      timedOut: false,
      lastError: null,
    });
  });

  test("uses machine user from profile default when --machine-user flag is absent", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("profile-bot");

    await startWorkflow({
      name: "my-workflow",
    });

    expect(loadMachineUserName).toHaveBeenCalledWith({
      machineUser: undefined,
      machineUserSource: undefined,
      profile: undefined,
    });
    expect(testStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authInvoker: expect.objectContaining({ machineUserName: "profile-bot" }),
      }),
    );
  });

  test("forwards the machineUser option to machine user resolution", async () => {
    await startWorkflow({ name: "my-workflow", machineUser: "flag-bot" });

    expect(loadMachineUserName).toHaveBeenCalledWith({
      machineUser: "flag-bot",
      machineUserSource: undefined,
      profile: undefined,
    });
  });

  test("throws when no machine user source is available", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);

    await expect(startWorkflow({ name: "my-workflow" })).rejects.toThrow(
      "Machine user is required",
    );
  });
});
