import { NotificationSeverity } from "@tailor-platform/tailor-proto/notification_resource_pb";
import { sanitizeTerminalText, styles, symbols } from "#/cli/shared/logger";

/** The part of a notification the banner shows. */
export interface BannerNotification {
  severity: NotificationSeverity;
  title: string;
}

/** The banner as lines: a header for `logger.warn`, then detail lines for `logger.log`. */
export interface NotificationBanner {
  header: string;
  lines: string[];
}

const ROW_PREFIX_WIDTH = "  X CRITICAL  ".length;
const MIN_TITLE_WIDTH = 20;
const DEFAULT_COLUMNS = 80;

function severityRank(severity: NotificationSeverity): number {
  return severity === NotificationSeverity.CRITICAL ? 0 : 1;
}

function severityCell(severity: NotificationSeverity): string {
  return severity === NotificationSeverity.CRITICAL
    ? `${symbols.error} ${styles.bold("CRITICAL")}`
    : `${symbols.warning} ${styles.bold("WARNING ")}`;
}

function truncate(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text;
  return chars.slice(0, Math.max(width - 1, 1)).join("") + "…";
}

/**
 * Lay out the post-command banner for the unread WARNING and CRITICAL notifications.
 * @param notifications - The page of notifications the lookup returned (at most a few)
 * @param totalCount - How many unread notifications at that severity there are in all
 * @param columns - Terminal width to fit rows into
 * @returns Header and detail lines, already styled
 */
export function formatNotificationBanner(
  notifications: readonly BannerNotification[],
  totalCount: number,
  columns: number = process.stderr.columns || DEFAULT_COLUMNS,
): NotificationBanner {
  const count = Math.max(totalCount, notifications.length);
  const header =
    count === 1
      ? "1 unread notification needs your attention"
      : `${count} unread notifications need your attention`;

  const titleWidth = Math.max(columns - ROW_PREFIX_WIDTH, MIN_TITLE_WIDTH);
  const rows = notifications
    .toSorted((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .map(
      (n) =>
        `  ${severityCell(n.severity)}  ${truncate(sanitizeTerminalText(n.title), titleWidth)}`,
    );

  const lines = [...rows];
  const more = count - notifications.length;
  if (more > 0) lines.push(styles.dim(`  …and ${more} more.`));
  lines.push(styles.dim("  Run `tailor notification list` for details."));
  return { header, lines };
}
