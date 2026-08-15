import { runCommand } from "@politty/valibot";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { triggerCommand, triggerExecutor } from "./trigger";
import type { ExecutorJob } from "@tailor-platform/tailor-proto/executor_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  fetchAll: async <T>(
    fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>,
  ): Promise<T[]> => {
    const [items] = await fn("", 1000);
    return items;
  },
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

describe("triggerExecutor", () => {
  let triggerExecutorMock: ReturnType<typeof vi.fn>;

  aroundEach(async (runTest) => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");

    triggerExecutorMock = vi.fn().mockResolvedValue({
      jobId: "job-1",
    });

    vi.mocked(initOperatorClient).mockResolvedValue({
      triggerExecutor: triggerExecutorMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    await runTest();
  });

  test("triggers a webhook executor by definition and forwards the payload", async () => {
    const result = await triggerExecutor({
      executor: {
        name: "my-executor",
        trigger: { kind: "incomingWebhook" },
      },
      payload: { body: { message: "hello" } },
    });

    expect(result).toEqual({ jobId: "job-1" });
    expect(triggerExecutorMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "my-executor",
      payload: { body: { message: "hello" } },
    });
  });

  test("rejects a payload for an executor whose trigger is not an incoming webhook", async () => {
    await expect(
      triggerExecutor({
        executor: {
          name: "scheduled-executor",
          trigger: { kind: "schedule", cron: "0 * * * *", timezone: "UTC" },
        },
        // @ts-expect-error - the type also rejects a payload for a non-webhook trigger
        payload: { body: { message: "hello" } },
      }),
    ).rejects.toThrow(/only available for 'incomingWebhook' trigger type/);
    expect(triggerExecutorMock).not.toHaveBeenCalled();
  });

  test("trigger command wait with jsonMode emits only parseable JSON to stdout", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    vi.mocked(initOperatorClient).mockResolvedValue({
      getExecutorExecutor: vi.fn().mockResolvedValue({
        executor: {
          triggerType: ExecutorTriggerType.INCOMING_WEBHOOK,
          targetType: ExecutorTargetType.WEBHOOK,
        },
      }),
      triggerExecutor: triggerExecutorMock,
      getExecutorJob: vi.fn().mockResolvedValue({
        job: {
          id: "job-1",
          executorName: "my-executor",
          status: ExecutorJobStatus.SUCCESS,
        } as ExecutorJob,
      }),
      listExecutorJobAttempts: vi.fn().mockResolvedValue({
        attempts: [],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    await runCommand(triggerCommand, [
      "my-executor",
      "--wait",
      "--timeout",
      "1s",
      "--interval",
      "1ms",
    ]);

    expect(JSON.parse(stdout.output)).toMatchObject({
      targetType: "WEBHOOK",
      attempts: 1,
      timedOut: false,
      lastError: null,
      job: {
        id: "job-1",
        executorName: "my-executor",
        status: "SUCCESS",
      },
    });
  });
});
