import { Code, ConnectError } from "@connectrpc/connect";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
} from "@tailor-proto/tailor/v1/executor_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { watchExecutorJob } from "./jobs";
import type { ExecutorJob } from "@tailor-proto/tailor/v1/executor_resource_pb";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("@/cli/shared/client", () => ({
  fetchAll: async <T>(
    fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>,
  ): Promise<T[]> => {
    const [items] = await fn("", 1000);
    return items;
  },
  initOperatorClient: vi.fn(),
}));

function executorJob(status: ExecutorJobStatus): ExecutorJob {
  return {
    id: "job-1",
    executorName: "my-executor",
    status,
  } as ExecutorJob;
}

describe("watchExecutorJob", () => {
  let getExecutorJobMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");

    getExecutorJobMock = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("temporarily unavailable", Code.Unavailable))
      .mockResolvedValueOnce({
        job: executorJob(ExecutorJobStatus.SUCCESS),
      });

    vi.mocked(initOperatorClient).mockResolvedValue({
      getExecutorExecutor: vi.fn().mockResolvedValue({
        executor: {
          targetType: ExecutorTargetType.WEBHOOK,
        },
      }),
      getExecutorJob: getExecutorJobMock,
      listExecutorJobAttempts: vi.fn().mockResolvedValue({
        attempts: [],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  test("retries retryable job polling failures", async () => {
    const result = await watchExecutorJob({
      executorName: "my-executor",
      jobId: "job-1",
      interval: 1,
      timeout: 100,
      showProgress: false,
    });

    expect(result).toMatchObject({
      targetType: "WEBHOOK",
      attempts: 2,
      timedOut: false,
      lastError: null,
      job: {
        id: "job-1",
        executorName: "my-executor",
        status: "SUCCESS",
      },
    });
  });

  test("returns timeout diagnostics with the last observed job status", async () => {
    getExecutorJobMock.mockReset().mockResolvedValue({
      job: executorJob(ExecutorJobStatus.PENDING),
    });

    const result = await watchExecutorJob({
      executorName: "my-executor",
      jobId: "job-1",
      interval: 1,
      timeout: 5,
      showProgress: false,
    });

    expect(result).toMatchObject({
      targetType: "WEBHOOK",
      timedOut: true,
      lastError: null,
      job: {
        id: "job-1",
        executorName: "my-executor",
        status: "PENDING",
      },
    });
    expect(result.attempts).toBeGreaterThan(0);
  });
});
