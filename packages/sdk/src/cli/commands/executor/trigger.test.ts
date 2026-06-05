import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { triggerExecutor } from "./trigger";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn<MockProcedure>(),
  loadWorkspaceId: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn<MockProcedure>(),
}));

describe("triggerExecutor runtime overload", () => {
  let triggerExecutorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");

    triggerExecutorMock = vi.fn<MockProcedure>().mockResolvedValue({
      jobId: "job-1",
    });

    vi.mocked(initOperatorClient).mockResolvedValue({
      triggerExecutor: triggerExecutorMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  test("prefers legacy shape when executorName exists even if executor key is present", async () => {
    await triggerExecutor({
      executorName: "legacy-executor",
      payload: {
        body: {
          message: "hello",
        },
      },
      executor: {
        name: "typed-executor",
        trigger: {
          kind: "incomingWebhook",
        },
      },
    } as never);

    expect(triggerExecutorMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "legacy-executor",
      payload: {
        body: {
          message: "hello",
        },
      },
    });
  });
});
