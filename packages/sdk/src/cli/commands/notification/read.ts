import { arg } from "@politty/zod";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger, styles } from "#/cli/shared/logger";
import { createNotificationClient } from "./client";
import { notificationNotFound, rethrowNotificationError } from "./errors";
import { transformNotificationDetail, type NotificationDetailInfo } from "./transform";

/** MarkMyNotificationsRead accepts at most this many ids per call. */
const MARK_READ_BATCH = 100;

function formatDetail(detail: NotificationDetailInfo): string {
  const lines = [
    styles.bold(detail.title),
    `${styles.dim("id:")} ${detail.id}`,
    `${styles.dim("severity:")} ${detail.severity}   ${styles.dim("category:")} ${detail.category}`,
    `${styles.dim("arrived:")} ${humanizeRelativeTime(detail.arrivedAt)}   ${styles.dim("expires:")} ${
      detail.expiresAt ? humanizeRelativeTime(detail.expiresAt) : "never"
    }`,
  ];
  if (detail.scopes.length > 0) {
    lines.push(`${styles.dim("about:")} ${detail.scopes.join(", ")}`);
  }
  lines.push("", detail.bodyMarkdown.trimEnd());
  if (detail.actions.length > 0) {
    lines.push("", styles.dim("Actions:"));
    for (const action of detail.actions) {
      lines.push(`- ${action.label}: ${action.url}`);
    }
  }
  return lines.join("\n") + "\n";
}

export const readCommand = defineAppCommand({
  name: "read",
  description: "Show a notification and mark it as read.",
  args: z.strictObject({
    id: arg(z.array(z.uuid()).min(1), {
      positional: true,
      description: "Notification ID (repeatable)",
    }),
    "no-mark-read": arg(z.boolean().default(false), {
      description: "Show the notification without marking it as read",
    }),
    profile: workspaceArgs.profile,
  }),
  run: async (args) => {
    const client = await createNotificationClient(args.profile);

    const details: NotificationDetailInfo[] = [];
    for (const id of args.id) {
      try {
        const { notification } = await client.getMyNotification({ notificationId: id });
        if (!notification) notificationNotFound(id);
        details.push(transformNotificationDetail(notification));
      } catch (error) {
        rethrowNotificationError(id, error);
      }
    }

    const markRead = !args["no-mark-read"];
    if (markRead) {
      const ids = details.map((detail) => detail.id);
      for (let start = 0; start < ids.length; start += MARK_READ_BATCH) {
        await client.markMyNotificationsRead({
          notificationIds: ids.slice(start, start + MARK_READ_BATCH),
        });
      }
    }

    if (logger.jsonMode) {
      logger.out(details.map((detail) => ({ ...detail, markedRead: markRead })));
      return;
    }
    logger.out(details.map(formatDetail).join("\n"));
  },
});
