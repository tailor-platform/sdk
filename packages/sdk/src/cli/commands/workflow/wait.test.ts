import { WorkflowExecution_Status } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { captureStderr, captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { waitCommand } from "./wait";
import type { WorkflowExecution } from "@tailor-proto/tailor/v1/workflow_resource_pb";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

function execution(status: WorkflowExecution_Status): WorkflowExecution {
  return {
    id: "execution-1",
    workflowName: "my-workflow",
    status,
    jobExecutions: [],
  } as unknown as WorkflowExecution;
}

describe("workflow wait command", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: execution(WorkflowExecution_Status.SUCCESS),
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  test("emits one parseable JSON object in json mode", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(waitCommand, [
      "execution-1",
      "--until",
      "success",
      "--timeout",
      "1s",
      "--interval",
      "1ms",
    ]);

    expect(JSON.parse(stdout.output)).toMatchObject({
      id: "execution-1",
      status: "SUCCESS",
      statusClass: "success",
      attempts: 1,
      timedOut: false,
      lastError: null,
    });
  });
});
