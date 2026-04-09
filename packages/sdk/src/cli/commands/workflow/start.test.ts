import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { resolveWorkflow } from "./get";
import { startWorkflow } from "./start";

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
});
