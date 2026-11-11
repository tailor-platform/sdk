import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  NotificationCategory,
  NotificationSchema,
  NotificationSeverity,
} from "@tailor-platform/tailor-proto/notification_resource_pb";
import { describe, expect, test } from "vitest";
import { transformNotification, transformNotificationDetail } from "./transform";

const arrivedAt = new Date("2026-10-29T01:02:03Z");
const expiresAt = new Date("2026-11-29T01:02:03Z");

function notification() {
  return create(NotificationSchema, {
    id: "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
    category: NotificationCategory.MAINTENANCE,
    severity: NotificationSeverity.WARNING,
    title: "Scheduled \u001b[31mmaintenance\u001b[0m\r on Nov 3",
    bodyMarkdown: "The **an-01** cluster is upgraded.\n\n- 02:00 UTC\n",
    actions: [{ label: "Status page", url: "https://status.example.com/" }],
    scopeRefs: [
      { ref: { case: "workspaceId", value: "6739b373-7371-4b50-99c9-a0c9db07cdee" } },
      { ref: { case: "region", value: "asia-northeast" } },
    ],
    arrivedAt: timestampFromDate(arrivedAt),
    expiresAt: timestampFromDate(expiresAt),
  });
}

describe("transformNotification", () => {
  test("flattens enums, timestamps and scope refs into a row and sanitizes the title", () => {
    expect(transformNotification(notification())).toEqual({
      id: "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e",
      severity: "warning",
      category: "maintenance",
      title: "Scheduled maintenance on Nov 3",
      scopes: ["workspace:6739b373-7371-4b50-99c9-a0c9db07cdee", "region:asia-northeast"],
      arrivedAt,
      readAt: null,
      expiresAt,
    });
  });

  test("labels unknown enum values as unknown", () => {
    const n = notification();
    n.category = 99 as NotificationCategory;
    n.severity = 99 as NotificationSeverity;
    const row = transformNotification(n);
    expect(row.category).toBe("unknown");
    expect(row.severity).toBe("unknown");
  });

  test("reports readAt when the notification has been read", () => {
    const readAt = new Date("2026-10-29T02:00:00Z");
    const n = notification();
    n.readAt = timestampFromDate(readAt);
    expect(transformNotification(n).readAt).toEqual(readAt);
  });
});

describe("transformNotificationDetail", () => {
  test("adds the body and the actions, with the body left intact apart from terminal escapes", () => {
    const n = notification();
    n.bodyMarkdown = "Line one\u001b[2J\n\n- item\n";
    const detail = transformNotificationDetail(n);
    expect(detail.bodyMarkdown).toBe("Line one\n\n- item\n");
    expect(detail.actions).toEqual([{ label: "Status page", url: "https://status.example.com/" }]);
    expect(detail.title).toBe("Scheduled maintenance on Nov 3");
  });
});
