import {
  NotificationCategory,
  NotificationSeverity,
} from "@tailor-platform/tailor-proto/notification_resource_pb";
import { formatTimestamp } from "#/cli/shared/format";
import { sanitizeTerminalBlock, sanitizeTerminalText } from "#/cli/shared/logger";
import { protoEnumLookup } from "#/cli/shared/proto-enum";
import type {
  Notification,
  NotificationScopeRef,
} from "@tailor-platform/tailor-proto/notification_resource_pb";

/** One inbox entry as listed by `tailor notification list`. */
export interface NotificationInfo {
  id: string;
  severity: string;
  category: string;
  title: string;
  /** What the notification is about, as `workspace:<id>`, `organization:<id>` or `region:<label>`. */
  scopes: string[];
  arrivedAt: Date | null;
  /** `null` while unread. */
  readAt: Date | null;
  /** `null` when the notification never expires. */
  expiresAt: Date | null;
}

/** A call-to-action link attached to a notification. */
interface NotificationActionInfo {
  label: string;
  url: string;
}

/** One inbox entry with its body, as shown by `tailor notification read`. */
export interface NotificationDetailInfo extends NotificationInfo {
  bodyMarkdown: string;
  actions: NotificationActionInfo[];
}

const SEVERITY_LABEL = {
  [NotificationSeverity.UNSPECIFIED]: "unknown",
  [NotificationSeverity.INFO]: "info",
  [NotificationSeverity.WARNING]: "warning",
  [NotificationSeverity.CRITICAL]: "critical",
} satisfies Record<NotificationSeverity, string>;

const CATEGORY_LABEL = {
  [NotificationCategory.UNSPECIFIED]: "unknown",
  [NotificationCategory.ALERT]: "alert",
  [NotificationCategory.INCIDENT]: "incident",
  [NotificationCategory.MAINTENANCE]: "maintenance",
  [NotificationCategory.ANNOUNCEMENT]: "announcement",
} satisfies Record<NotificationCategory, string>;

function severityLabel(severity: NotificationSeverity): string {
  return protoEnumLookup(SEVERITY_LABEL, severity, "unknown");
}

function categoryLabel(category: NotificationCategory): string {
  return protoEnumLookup(CATEGORY_LABEL, category, "unknown");
}

function scopeRefLabel(ref: NotificationScopeRef): string | undefined {
  switch (ref.ref.case) {
    case "workspaceId":
      return `workspace:${ref.ref.value}`;
    case "organizationId":
      return `organization:${ref.ref.value}`;
    case "region":
      return `region:${sanitizeTerminalText(ref.ref.value)}`;
    default:
      return undefined;
  }
}

/**
 * Transform a Notification into the row `tailor notification list` prints.
 * @param notification - Notification resource from the platform
 * @returns Flattened inbox row, with the title made safe for the terminal
 */
export function transformNotification(notification: Notification): NotificationInfo {
  return {
    id: notification.id,
    severity: severityLabel(notification.severity),
    category: categoryLabel(notification.category),
    title: sanitizeTerminalText(notification.title),
    scopes: notification.scopeRefs.map(scopeRefLabel).filter((s) => s !== undefined),
    arrivedAt: formatTimestamp(notification.arrivedAt),
    readAt: formatTimestamp(notification.readAt),
    expiresAt: formatTimestamp(notification.expiresAt),
  };
}

/**
 * Transform a Notification into what `tailor notification read` prints: the list row plus the
 * Markdown body and the call-to-action links.
 * @param notification - Notification resource from the platform
 * @returns Inbox entry with body and actions, made safe for the terminal
 */
export function transformNotificationDetail(notification: Notification): NotificationDetailInfo {
  return {
    ...transformNotification(notification),
    bodyMarkdown: sanitizeTerminalBlock(notification.bodyMarkdown),
    actions: notification.actions.map((action) => ({
      label: sanitizeTerminalText(action.label),
      url: sanitizeTerminalText(action.url),
    })),
  };
}
