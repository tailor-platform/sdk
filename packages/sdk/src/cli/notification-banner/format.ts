import { NotificationSeverity } from "@tailor-platform/tailor-proto/notification_resource_pb";
import { displayWidth } from "#/cli/shared/ascii-table";
import { formatCommandHint } from "#/cli/shared/errors";
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

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Cut text to a terminal display width, by whole graphemes, ending with an ellipsis when cut.
 * Wide (CJK) characters and emoji count as two columns.
 * @param text - Plain text
 * @param width - Columns available
 * @returns Text that fits in `width` columns
 */
function truncate(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const w = displayWidth(segment);
    if (used + w > width - 1) break;
    out += segment;
    used += w;
  }
  return out + "\u2026";
}

/** Options for {@link formatNotificationBanner}. */
interface FormatOptions {
  /** Terminal width to fit rows into; defaults to stderr's width or 80. */
  columns?: number | undefined;
  /** Profile the command named explicitly, repeated in the hint so it opens the same inbox. */
  profile?: string | undefined;
}

/**
 * Lay out the post-command banner for the unread WARNING and CRITICAL notifications.
 * @param notifications - The page of notifications the lookup returned (at most a few)
 * @param totalCount - How many unread notifications at that severity there are in all
 * @param options - Width and profile
 * @returns Header and detail lines, already styled
 */
export function formatNotificationBanner(
  notifications: readonly BannerNotification[],
  totalCount: number,
  options: FormatOptions = {},
): NotificationBanner {
  const count = Math.max(totalCount, notifications.length);
  const header =
    count === 1
      ? "1 unread notification needs your attention"
      : `${count} unread notifications need your attention`;

  const columns = options.columns ?? (process.stderr.columns || DEFAULT_COLUMNS);
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
  const listArgs = [
    "notification",
    "list",
    ...(options.profile ? ["--profile", options.profile] : []),
  ];
  const hint = formatCommandHint({ command: "tailor", args: listArgs });
  lines.push(styles.dim(`  Run ${hint} for details.`));
  return { header, lines };
}
