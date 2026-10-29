import { arg } from "@politty/zod";
import {
  NotificationCategory,
  NotificationSeverity,
} from "@tailor-platform/tailor-proto/notification_resource_pb";
import { z } from "zod";
import { paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { fetchWithinLimit, reportTruncation } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { createNotificationClient } from "./client";
import { transformNotification, type NotificationInfo } from "./transform";

const CATEGORY_FLAG = {
  alert: NotificationCategory.ALERT,
  incident: NotificationCategory.INCIDENT,
  maintenance: NotificationCategory.MAINTENANCE,
  announcement: NotificationCategory.ANNOUNCEMENT,
} as const;

const SEVERITY_FLAG = {
  info: NotificationSeverity.INFO,
  warning: NotificationSeverity.WARNING,
  critical: NotificationSeverity.CRITICAL,
} as const;

const categoryNames = Object.keys(CATEGORY_FLAG) as [keyof typeof CATEGORY_FLAG];
const severityNames = Object.keys(SEVERITY_FLAG) as [keyof typeof SEVERITY_FLAG];

export const listCommand = defineAppCommand({
  name: "list",
  description: "List the notifications in your inbox.",
  args: z.strictObject({
    ...paginationArgs(),
    profile: workspaceArgs.profile,
    category: arg(z.enum(categoryNames).optional(), {
      description: `Only this category (${categoryNames.join(", ")})`,
    }),
    severity: arg(z.enum(severityNames).optional(), {
      description: `Only this severity or higher (${severityNames.join(", ")})`,
    }),
    unread: arg(z.boolean().default(false), {
      description: "Only unread notifications",
    }),
    "scope-workspace": arg(z.uuid().optional(), {
      description: "Only notifications about this workspace ID",
    }),
    "scope-organization": arg(z.uuid().optional(), {
      description: "Only notifications about this organization ID",
    }),
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const client = await createNotificationClient(args.profile);

    const pageDirection = toPageDirection(args.order);
    const category = args.category
      ? CATEGORY_FLAG[args.category]
      : NotificationCategory.UNSPECIFIED;
    const minSeverity = args.severity
      ? SEVERITY_FLAG[args.severity]
      : NotificationSeverity.UNSPECIFIED;
    const listed = await fetchWithinLimit(args.limit, (limit) =>
      fetchPaged(
        async (pageToken, pageSize) => {
          const { notifications, nextPageToken } = await client.listMyNotifications({
            pageToken,
            pageSize,
            pageDirection,
            category,
            minSeverity,
            unreadOnly: args.unread,
            scopeWorkspaceId: args["scope-workspace"] ?? "",
            scopeOrganizationId: args["scope-organization"] ?? "",
          });
          return [notifications, nextPageToken];
        },
        { limit },
      ),
    );

    if (listed.items.length === 0) {
      logger.info("No notifications.");
      if (!jsonOutput) {
        return;
      }
    }

    const rows: NotificationInfo[] = listed.items.map(transformNotification);
    logger.out(rows, {
      display: {
        scopes: null,
        expiresAt: null,
        arrivedAt: (value) => humanizeRelativeTime(value as Date | null),
        readAt: (value) => (value === null ? "unread" : humanizeRelativeTime(value as Date)),
      },
    });
    await reportTruncation(listed, args.limit);
  },
});
