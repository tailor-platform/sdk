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

/** How many notifications the banner names; the rest are counted. */
const SHOWN_ROWS = 3;
const ROW_PREFIX_WIDTH = "  X CRITICAL  ".length;
// formatCommandHint would shell-quote a literal `<id>`, so a bare word stands in for it.
const ID_PLACEHOLDER = "NOTIFICATION_ID";
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
 * Lay out the post-command banner for the unread WARNING and CRITICAL notifications: the
 * {@link SHOWN_ROWS} most severe of the page (newest first within a severity), then a count of
 * the rest.
 * @param notifications - The page of notifications the lookup returned, newest first
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
  const sorted = notifications.toSorted(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  const shown = sorted.slice(0, SHOWN_ROWS);
  const lines = shown.map(
    (n) => `  ${severityCell(n.severity)}  ${truncate(sanitizeTerminalText(n.title), titleWidth)}`,
  );

  const more = count - shown.length;
  if (more > 0) {
    // The CRITICAL count is exact only when the page holds every unread notification.
    const hiddenCritical =
      notifications.length >= count
        ? sorted.slice(SHOWN_ROWS).filter((n) => n.severity === NotificationSeverity.CRITICAL)
            .length
        : 0;
    const detail = hiddenCritical > 0 ? ` (${hiddenCritical} CRITICAL)` : "";
    lines.push(styles.dim(`  …and ${more} more${detail}.`));
  }
  const profileArgs = options.profile ? ["--profile", options.profile] : [];
  const listHint = formatCommandHint({
    command: "tailor",
    args: ["notification", "list", ...profileArgs],
  });
  const readHint = formatCommandHint({
    command: "tailor",
    args: ["notification", "read", ID_PLACEHOLDER, ...profileArgs],
  }).replaceAll(` read ${ID_PLACEHOLDER}`, " read <id>");
  lines.push(styles.dim(`  Run ${listHint} for details.`));
  lines.push(styles.dim(`  Run ${readHint} to clear a notification.`));
  return { header, lines };
}
