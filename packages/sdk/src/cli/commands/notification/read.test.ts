import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import {
  NotificationCategory,
  NotificationSeverity,
} from "@tailor-platform/tailor-proto/notification_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { readCommand } from "./read";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
}));

const ID_A = "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e";
const ID_B = "1d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e";
const arrivedAt = new Date("2026-10-29T01:02:03Z");

function notification(id: string, title = "Scheduled maintenance") {
  return {
    id,
    category: NotificationCategory.MAINTENANCE,
    severity: NotificationSeverity.WARNING,
    title,
    bodyMarkdown: "The **an-01** cluster is upgraded.\n\n- 02:00 UTC\n",
    actions: [{ label: "Status page", url: "https://status.example.com/" }],
    scopeRefs: [],
    arrivedAt: timestampFromDate(arrivedAt),
  };
}

function mockClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const client = {
    getMyNotification: vi.fn(async ({ notificationId }: { notificationId: string }) => ({
      notification: notification(notificationId),
    })),
    markMyNotificationsRead: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  vi.mocked(initOperatorClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  return client;
}

function captureStdout() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    text: () => chunks.join(""),
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}

describe("notification read", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("scoped-token");
    await runTest();
    vi.unstubAllEnvs();
  });

  test("prints the notification and marks it read", async () => {
    const client = mockClient();
    using stdout = captureStdout();

    const result = await runCommand(readCommand, [ID_A]);

    expect(result.success).toBe(true);
    expect(client.getMyNotification).toHaveBeenCalledWith({ notificationId: ID_A });
    expect(client.markMyNotificationsRead).toHaveBeenCalledExactlyOnceWith({
      notificationIds: [ID_A],
    });
    const text = stdout.text();
    expect(text).toContain("Scheduled maintenance");
    expect(text).toContain("warning");
    expect(text).toContain("maintenance");
    expect(text).toContain("The **an-01** cluster is upgraded.\n\n- 02:00 UTC");
    expect(text).toContain("Status page: https://status.example.com/");
  });

  test("fetches every id and marks them read in one call", async () => {
    const client = mockClient();
    using _stdout = captureStdout();

    const result = await runCommand(readCommand, [ID_A, ID_B]);

    expect(result.success).toBe(true);
    expect(client.getMyNotification).toHaveBeenCalledTimes(2);
    expect(client.markMyNotificationsRead).toHaveBeenCalledExactlyOnceWith({
      notificationIds: [ID_A, ID_B],
    });
  });

  test("--no-mark-read only displays", async () => {
    const client = mockClient();
    using _stdout = captureStdout();

    const result = await runCommand(readCommand, [ID_A, "--no-mark-read"]);

    expect(result.success).toBe(true);
    expect(client.markMyNotificationsRead).not.toHaveBeenCalled();
  });

  test("strips terminal escapes from the title and body", async () => {
    mockClient({
      getMyNotification: vi.fn().mockResolvedValue({
        notification: {
          ...notification(ID_A, "Scheduled \u001b[31mmaintenance\u001b[0m"),
          bodyMarkdown: "Line\u001b[2J one\n",
        },
      }),
    });
    using stdout = captureStdout();

    const result = await runCommand(readCommand, [ID_A]);

    expect(result.success).toBe(true);
    expect(stdout.text()).not.toContain("\u001b[31m");
    expect(stdout.text()).not.toContain("\u001b[2J");
    expect(stdout.text()).toContain("Line one");
  });

  test("reports NOTIFICATION_NOT_FOUND when the platform answers NotFound", async () => {
    mockClient({
      getMyNotification: vi
        .fn()
        .mockRejectedValue(new ConnectError("not addressed to you", Code.NotFound)),
    });
    using _stdout = captureStdout();

    const result = await runCommand(readCommand, [ID_A]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
    expect(String((result.error as Error).message)).toContain(ID_A);
  });

  test("rejects an id that is not a UUID", async () => {
    mockClient();
    using _stdout = captureStdout();

    const result = await runCommand(readCommand, ["not-a-uuid"]);

    expect(result.success).toBe(false);
  });

  test("prints the full entries with the body and a markedRead flag in JSON mode", async () => {
    mockClient();
    using _json = jsonMode();
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runCommand(readCommand, [ID_A]);

    expect(result.success).toBe(true);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual([
      {
        id: ID_A,
        severity: "warning",
        category: "maintenance",
        title: "Scheduled maintenance",
        scopes: [],
        arrivedAt: arrivedAt.toISOString(),
        readAt: null,
        expiresAt: null,
        bodyMarkdown: "The **an-01** cluster is upgraded.\n\n- 02:00 UTC\n",
        actions: [{ label: "Status page", url: "https://status.example.com/" }],
        markedRead: true,
      },
    ]);
  });
});
