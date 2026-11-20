import { runCommand } from "@politty/zod";
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
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { triggerCommand, triggerExecutor } from "./trigger";
import type { OperatorClient } from "#/cli/shared/client";

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

function createClient() {
  return mockOperatorClient({
    triggerExecutor: {
      jobId: "job-1",
    },
  });
}

describe("triggerExecutor", () => {
  let client: ReturnType<typeof createClient>;

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");

    client = createClient();
    vi.mocked(initOperatorClient).mockResolvedValue(client);
    await runTest();
  });

  function mockIncomingWebhookClient<K extends keyof OperatorClient = never>(
    overrides?: OperatorClientMocks<K>,
  ) {
    client = withOperatorClientMocks(
      withOperatorClientMocks(client, {
        getExecutorExecutor: {
          executor: {
            triggerType: ExecutorTriggerType.INCOMING_WEBHOOK,
            targetType: ExecutorTargetType.WEBHOOK,
          },
        },
      }),
      overrides,
    );
    vi.mocked(initOperatorClient).mockResolvedValue(client);
  }

  test("triggers a webhook executor by definition and forwards the payload", async () => {
    const result = await triggerExecutor({
      executor: {
        name: "my-executor",
        trigger: { kind: "incomingWebhook" },
      },
      payload: { message: "hello" },
    });

    expect(result).toEqual({ jobId: "job-1" });
    expect(client.triggerExecutor).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "my-executor",
      payload: { message: "hello" },
    });
  });

  test("trigger command sends --data as the payload unchanged", async () => {
    mockIncomingWebhookClient();

    const result = await runCommand(triggerCommand, [
      "my-executor",
      "--data",
      '{"email":"a@example.com"}',
    ]);

    expect(result.success).toBe(true);
    expect(client.triggerExecutor).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "my-executor",
      payload: { email: "a@example.com" },
    });
  });

  test.each([
    {
      name: "one value stays a string",
      headerArgs: ["X-Test: v1"],
      headers: { "x-test": "v1" },
    },
    {
      name: "a name given twice becomes a list in the given order",
      headerArgs: ["Accept: application/json", "Accept: text/html"],
      headers: { accept: ["application/json", "text/html"] },
    },
    {
      name: "names that differ only in letter case are one header",
      headerArgs: ["X-Request-Id: a", "x-request-id: b", "X-Other: c"],
      headers: { "x-request-id": ["a", "b"], "x-other": "c" },
    },
    {
      name: "a value keeps its own colons and is trimmed",
      headerArgs: ["Referer:  https://example.com:8080/a "],
      headers: { referer: "https://example.com:8080/a" },
    },
  ])("trigger command sends --header as headers ($name)", async ({ headerArgs, headers }) => {
    using stderr = captureStderr();
    mockIncomingWebhookClient();

    const result = await runCommand(triggerCommand, [
      "my-executor",
      ...headerArgs.flatMap((header) => ["--header", header]),
    ]);

    expect(result.success).toBe(true);
    expect(client.triggerExecutor).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "my-executor",
      payload: undefined,
      headers,
    });
    expect(stderr.output).not.toContain("not passed to the executor");
  });

  test("trigger command sends --data and --header together", async () => {
    mockIncomingWebhookClient();

    const result = await runCommand(triggerCommand, [
      "my-executor",
      "--data",
      '{"email":"a@example.com"}',
      "--header",
      "X-Test: v1",
    ]);

    expect(result.success).toBe(true);
    expect(client.triggerExecutor).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "my-executor",
      payload: { email: "a@example.com" },
      headers: { "x-test": "v1" },
    });
  });

  test("triggers a webhook executor by definition and forwards the headers", async () => {
    await triggerExecutor({
      executor: {
        name: "my-executor",
        trigger: { kind: "incomingWebhook" },
      },
      headers: { "x-request-id": "req-1", accept: ["application/json", "text/html"] },
    });

    expect(client.triggerExecutor).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executorName: "my-executor",
      payload: undefined,
      headers: { "x-request-id": "req-1", accept: ["application/json", "text/html"] },
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
        payload: { message: "hello" },
      }),
    ).rejects.toThrow(/The 'payload' option is only available for 'incomingWebhook' trigger type/);
    expect(client.triggerExecutor).not.toHaveBeenCalled();
  });

  test("rejects headers for an executor whose trigger is not an incoming webhook", async () => {
    await expect(
      triggerExecutor({
        executor: {
          name: "scheduled-executor",
          trigger: { kind: "schedule", cron: "0 * * * *", timezone: "UTC" },
        },
        // @ts-expect-error - the type also rejects headers for a non-webhook trigger
        headers: { "x-request-id": "req-1" },
      }),
    ).rejects.toThrow(/The 'headers' option is only available for 'incomingWebhook' trigger type/);
    expect(client.triggerExecutor).not.toHaveBeenCalled();
  });

  test("trigger command wait with jsonMode emits only parseable JSON to stdout", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    mockIncomingWebhookClient({
      getExecutorJob: {
        job: {
          id: "job-1",
          executorName: "my-executor",
          status: ExecutorJobStatus.SUCCESS,
        },
      },
      listExecutorJobAttempts: {
        attempts: [],
        nextPageToken: "",
      },
    });

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
