import { runCommand } from "@politty/zod";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadMachineUserName, loadWorkspaceId } from "#/cli/shared/context";
import {
  captureStderr,
  captureStdout,
  captureStdoutStream,
} from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resolveWorkflow } from "./get";
import { resumeCommand } from "./resume";
import { startCommand, startWorkflow, startWorkflowByName } from "./start";
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

function executionResponse(status: WorkflowExecution_Status, jobExecutions: unknown[] = []) {
  return {
    execution: {
      id: "execution-1",
      workflowName: "legacy-workflow",
      status,
      jobExecutions,
    } as unknown as WorkflowExecution,
  };
}

function runWaitCommand(command: "start" | "resume", ...flags: string[]) {
  return command === "start"
    ? runCommand(startCommand, [
        "legacy-workflow",
        "--machine-user",
        "legacy-user",
        "--wait",
        ...flags,
      ])
    : runCommand(resumeCommand, ["execution-1", "--wait", ...flags]);
}

describe("startWorkflow", () => {
  let getApplicationMock: ReturnType<typeof vi.fn>;
  let getWorkflowExecutionMock: ReturnType<typeof vi.fn>;
  let startWorkflowMock: ReturnType<typeof vi.fn>;

  aroundEach(async (runTest) => {
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
    startWorkflowMock = vi.fn().mockResolvedValue({
      executionId: "execution-1",
    });
    getWorkflowExecutionMock = vi
      .fn()
      .mockResolvedValue(executionResponse(WorkflowExecution_Status.SUCCESS));

    vi.mocked(initOperatorClient).mockResolvedValue({
      getApplication: getApplicationMock,
      getWorkflowExecution: getWorkflowExecutionMock,
      startWorkflow: startWorkflowMock,
      resumeWorkflowExecution: vi.fn().mockResolvedValue({ executionId: "execution-1" }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    vi.mocked(resolveWorkflow).mockImplementation(async (_client, _workspaceId, workflowName) => {
      return {
        id: `id:${workflowName}`,
      } as never;
    });
    await runTest();
  });

  test("typed shape resolves auth namespace from config and sends proto credentials", async () => {
    await startWorkflow({
      workflow: {
        name: "typed-workflow",
        mainJob: {
          body: () => undefined,
        },
      },
      invoker: "typed-user",
    });

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(getApplicationMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      applicationName: "my-app",
    });
    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "id:typed-workflow",
        authInvoker: expect.objectContaining({
          namespace: "auth-ns",
          machineUserName: "typed-user",
        }),
      }),
    );
  });

  test("typed shape falls back to external auth config name", async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      config: {
        name: "my-app",
        auth: { name: "external-auth", external: true },
      },
    } as Awaited<ReturnType<typeof loadConfig>>);
    getApplicationMock.mockResolvedValueOnce({
      application: {},
    });

    await startWorkflow({
      workflow: {
        name: "typed-workflow",
        mainJob: {
          body: () => undefined,
        },
      },
      invoker: "typed-user",
    });

    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "id:typed-workflow",
        authInvoker: expect.objectContaining({
          namespace: "external-auth",
          machineUserName: "typed-user",
        }),
      }),
    );
  });

  test("throws when neither the deployed app nor the config has an auth namespace", async () => {
    getApplicationMock.mockResolvedValueOnce({
      application: {},
    });

    await expect(
      startWorkflow({
        workflow: {
          name: "typed-workflow",
          mainJob: {
            body: () => undefined,
          },
        },
        invoker: "typed-user",
      }),
    ).rejects.toThrow("my-app does not have an auth configuration");
    expect(startWorkflowMock).not.toHaveBeenCalled();
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

    await runWaitCommand("start", "--until", "success", "--timeout", "1s", "--interval", "1ms");

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

  test.each(["start", "resume"] as const)(
    "%s prints the wait result before reporting failure",
    async (command) => {
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();
      getWorkflowExecutionMock.mockResolvedValue(
        executionResponse(WorkflowExecution_Status.FAILED),
      );
      const result = await runWaitCommand(command);
      expect(result.success).toBe(false);
      expect(JSON.parse(stdout.output)).toMatchObject({ id: "execution-1", status: "FAILED" });
      expect(getWorkflowExecutionMock).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["start", "resume"] as const)(
    "%s shows refetched status with human logs",
    async (command) => {
      using stdout = captureStdoutStream();
      using _stderr = captureStderr();
      using _json = jsonMode(false);
      getWorkflowExecutionMock
        .mockResolvedValueOnce(executionResponse(WorkflowExecution_Status.SUCCESS))
        .mockResolvedValue(executionResponse(WorkflowExecution_Status.FAILED));
      const result = await runWaitCommand(command, "--logs");
      expect(result.success).toBe(true);
      expect(stdout.output).toContain("FAILED");
    },
  );

  test.each(["start", "resume"] as const)(
    "%s includes job details in JSON logs",
    async (command) => {
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();
      getWorkflowExecutionMock.mockResolvedValue(
        executionResponse(WorkflowExecution_Status.SUCCESS, [
          { id: "job-1", stackedJobName: "main", status: 0, executionId: "" },
        ]),
      );
      const result = await runWaitCommand(command, "--logs");
      expect(result.success).toBe(true);
      expect(JSON.parse(stdout.output)).toMatchObject({
        status: "SUCCESS",
        jobDetails: [{ id: "job-1", stackedJobName: "main" }],
      });
    },
  );

  test("uses machine user from profile default when --machine-user flag is absent", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("profile-bot");

    await startWorkflowByName({ name: "my-workflow" });

    expect(loadMachineUserName).toHaveBeenCalledWith({
      machineUser: undefined,
      machineUserSource: undefined,
      profile: undefined,
    });
    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authInvoker: expect.objectContaining({ machineUserName: "profile-bot" }),
      }),
    );
  });

  test("forwards the machineUser option to machine user resolution", async () => {
    await startWorkflowByName({ name: "my-workflow", machineUser: "flag-bot" });

    expect(loadMachineUserName).toHaveBeenCalledWith({
      machineUser: "flag-bot",
      machineUserSource: undefined,
      profile: undefined,
    });
  });

  test("throws when no machine user source is available", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);

    await expect(startWorkflowByName({ name: "my-workflow" })).rejects.toThrow(
      "Machine user is required",
    );
  });
});
