import { arg } from "@politty/zod";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConsoleBaseUrl } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger, styles } from "#/cli/shared/logger";
import { createNotificationClient } from "./client";
import { notificationNotFound, rethrowNotificationError } from "./errors";
import { transformNotificationDetail, type NotificationDetailInfo } from "./transform";

/** MarkMyNotificationsRead accepts at most this many ids per call. */
const MARK_READ_BATCH = 100;

/**
 * Whether an action URL is a same-origin path: exactly one leading slash (the platform refuses
 * protocol-relative `//host`).
 * @param url - Action URL from the platform
 * @returns true for a Console path to resolve
 */
function isConsolePath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

/**
 * Turn same-origin action paths into full Console URLs, so a terminal user can open them.
 * Absolute https:// URLs are kept as they are, and the Console is looked up only when needed.
 * @param details - Notifications as transformed for display
 * @param profile - Profile from `--profile`, which decides the Console origin
 * @returns The same notifications with path actions resolved
 */
async function resolveActionUrls(
  details: NotificationDetailInfo[],
  profile: string | undefined,
): Promise<NotificationDetailInfo[]> {
  if (!details.some((detail) => detail.actions.some((action) => isConsolePath(action.url)))) {
    return details;
  }
  const consoleBaseUrl = await loadConsoleBaseUrl({ profile, allowMissingProfile: true });
  return details.map((detail) => ({
    ...detail,
    actions: detail.actions.map((action) =>
      isConsolePath(action.url)
        ? { ...action, url: new URL(action.url, consoleBaseUrl).toString() }
        : action,
    ),
  }));
}

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

    const shown = await resolveActionUrls(details, args.profile);

    // Print before reporting a mark-read failure: if a later batch fails, everything fetched is
    // still shown, each entry with an accurate markedRead, and the failure is rethrown after.
    const marked = new Set<string>();
    const print = () => {
      if (logger.jsonMode) {
        logger.out(shown.map((detail) => ({ ...detail, markedRead: marked.has(detail.id) })));
      } else {
        logger.out(shown.map(formatDetail).join("\n"));
      }
    };
    if (!args["no-mark-read"]) {
      const ids = shown.map((detail) => detail.id);
      try {
        for (let start = 0; start < ids.length; start += MARK_READ_BATCH) {
          const batch = ids.slice(start, start + MARK_READ_BATCH);
          await client.markMyNotificationsRead({ notificationIds: batch });
          for (const id of batch) marked.add(id);
        }
      } catch (error) {
        print();
        throw error;
      }
    }
    print();
  },
});
