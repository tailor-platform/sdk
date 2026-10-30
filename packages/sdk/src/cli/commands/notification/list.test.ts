import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { runCommand } from "@politty/zod";
import {
  NotificationCategory,
  NotificationSeverity,
} from "@tailor-platform/tailor-proto/notification_resource_pb";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
}));

const WORKSPACE_ID = "6739b373-7371-4b50-99c9-a0c9db07cdee";
const ORGANIZATION_ID = "9fff4dcf-0000-4000-8000-000000000000";

function mockClient(listMyNotifications: ReturnType<typeof vi.fn>) {
  vi.mocked(initOperatorClient).mockResolvedValue({
    listMyNotifications,
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  return listMyNotifications;
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

function captureStderr() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
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

function tableRows(output: string): string[][] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .map((line) =>
      line
        .split("│")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe("notification list", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("scoped-token");
    mockClient(vi.fn().mockResolvedValue({ notifications: [], nextPageToken: "", totalCount: 0 }));
    await runTest();
    vi.unstubAllEnvs();
  });

  test("prefers an explicit profile over TAILOR_PLATFORM_PROFILE", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--profile", "prod"]);

    expect(result.success).toBe(true);
    expect(loadAccessToken).toHaveBeenCalledWith({ profile: "prod" });
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token");
  });

  test("lists the whole inbox newest first with no filters by default", async () => {
    const list = mockClient(
      vi.fn().mockResolvedValue({ notifications: [], nextPageToken: "", totalCount: 0 }),
    );
    using _json = jsonMode();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(list).toHaveBeenCalledWith({
      pageToken: "",
      pageSize: expect.any(Number),
      pageDirection: PageDirection.DESC,
      category: NotificationCategory.UNSPECIFIED,
      minSeverity: NotificationSeverity.UNSPECIFIED,
      unreadOnly: false,
      scopeWorkspaceId: "",
      scopeOrganizationId: "",
    });
  });

  test("maps the filter flags onto the request", async () => {
    const list = mockClient(
      vi.fn().mockResolvedValue({ notifications: [], nextPageToken: "", totalCount: 0 }),
    );
    using _json = jsonMode();

    const result = await runCommand(listCommand, [
      "--category",
      "maintenance",
      "--severity",
      "warning",
      "--unread",
      "--scope-workspace",
      WORKSPACE_ID,
      "--scope-organization",
      ORGANIZATION_ID,
      "--order",
      "asc",
    ]);

    expect(result.success).toBe(true);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        pageDirection: PageDirection.ASC,
        category: NotificationCategory.MAINTENANCE,
        minSeverity: NotificationSeverity.WARNING,
        unreadOnly: true,
        scopeWorkspaceId: WORKSPACE_ID,
        scopeOrganizationId: ORGANIZATION_ID,
      }),
    );
  });

  test("caps the listing at the 50 newest notifications by default", async () => {
    const arrivedAt = timestampFromDate(new Date("2026-10-29T01:02:03Z"));
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `0d2c0f1e-5c2b-4e3a-9c1d-${String(i).padStart(12, "0")}`,
      category: NotificationCategory.ANNOUNCEMENT,
      severity: NotificationSeverity.INFO,
      title: `n${i}`,
      bodyMarkdown: "",
      actions: [],
      scopeRefs: [],
      arrivedAt,
    }));
    const list = mockClient(
      vi.fn(async ({ pageSize }: { pageSize: number }) => ({
        notifications: many.slice(0, pageSize),
        nextPageToken: "",
        totalCount: many.length,
      })),
    );
    using _json = jsonMode();
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    using _stderr = captureStderr();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 51, pageDirection: PageDirection.DESC }),
    );
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toHaveLength(50);
  });

  test("--limit 0 lists everything", async () => {
    const list = mockClient(
      vi.fn().mockResolvedValue({ notifications: [], nextPageToken: "", totalCount: 0 }),
    );
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--limit", "0"]);

    expect(result.success).toBe(true);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ pageSize: expect.any(Number) }));
    expect(list.mock.calls[0]?.[0].pageSize).toBeGreaterThan(51);
  });

  test("rejects a scope that is not a UUID", async () => {
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--scope-workspace", "not-a-uuid"]);

    expect(result.success).toBe(false);
  });

  test("says so when the inbox is empty and prints no table", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(stdout.text()).toBe("");
    expect(stderr.text()).toContain("No notifications");
  });

  test("renders a table with a sanitized title and the read state", async () => {
    const arrivedAt = new Date(Date.now() - 60 * 60 * 1000);
    mockClient(
      vi.fn().mockResolvedValue({
        notifications: [
          {
            id: "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
            category: NotificationCategory.MAINTENANCE,
            severity: NotificationSeverity.WARNING,
            title: "Scheduled \u001b[31mmaintenance\u001b[0m",
            bodyMarkdown: "body",
            actions: [],
            scopeRefs: [],
            arrivedAt: timestampFromDate(arrivedAt),
          },
          {
            id: "1d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
            category: NotificationCategory.ANNOUNCEMENT,
            severity: NotificationSeverity.INFO,
            title: "Read one",
            bodyMarkdown: "body",
            actions: [],
            scopeRefs: [],
            arrivedAt: timestampFromDate(arrivedAt),
            readAt: timestampFromDate(arrivedAt),
          },
        ],
        nextPageToken: "",
        totalCount: 2,
      }),
    );
    using stdout = captureStdout();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(tableRows(stdout.text())).toEqual([
      ["id", "severity", "category", "title", "arrivedAt", "readAt"],
      [
        "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
        "warning",
        "maintenance",
        "Scheduled maintenance",
        expect.stringContaining("ago"),
        "unread",
      ],
      [
        "1d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
        "info",
        "announcement",
        "Read one",
        expect.stringContaining("ago"),
        expect.stringContaining("ago"),
      ],
    ]);
  });

  test("prints the full rows as JSON in JSON mode", async () => {
    const arrivedAt = new Date("2026-10-29T01:02:03Z");
    mockClient(
      vi.fn().mockResolvedValue({
        notifications: [
          {
            id: "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
            category: NotificationCategory.ALERT,
            severity: NotificationSeverity.CRITICAL,
            title: "Act now",
            bodyMarkdown: "body",
            actions: [],
            scopeRefs: [{ ref: { case: "workspaceId", value: WORKSPACE_ID } }],
            arrivedAt: timestampFromDate(arrivedAt),
          },
        ],
        nextPageToken: "",
        totalCount: 1,
      }),
    );
    using _json = jsonMode();
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual([
      {
        id: "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
        severity: "critical",
        category: "alert",
        title: "Act now",
        scopes: [`workspace:${WORKSPACE_ID}`],
        arrivedAt: arrivedAt.toISOString(),
        readAt: null,
        expiresAt: null,
      },
    ]);
  });
});
