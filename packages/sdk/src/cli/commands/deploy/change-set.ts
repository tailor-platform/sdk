import { logger, styles, symbols } from "@/cli/shared/logger";

export interface HasName {
  name: string;
  /**
   * Optional pre-formatted lines rendered indented beneath the item by
   * `ChangeSet.print()` (e.g. per-sub-resource diffs embedded in a single
   * resource).
   */
  details?: readonly string[];
}

export type ChangeSet<
  C extends HasName,
  U extends HasName,
  D extends HasName,
  R extends HasName = never,
  Un extends HasName = HasName,
> = {
  readonly title: string;
  readonly creates: C[];
  readonly updates: U[];
  readonly deletes: D[];
  readonly replaces: R[];
  readonly unchanged: Un[];
  isEmpty: () => boolean;
  print: () => void;
};

export interface PlanSummary {
  create: number;
  update: number;
  delete: number;
  replace: number;
  unchanged: number;
}

/**
 * Create a new ChangeSet for tracking resource changes.
 * @param title - Title for the change set
 * @returns Empty ChangeSet instance with isEmpty() and print() methods
 */
export function createChangeSet<
  C extends HasName,
  U extends HasName,
  D extends HasName,
  R extends HasName = never,
  Un extends HasName = HasName,
>(title: string): ChangeSet<C, U, D, R, Un> {
  const creates: C[] = [];
  const updates: U[] = [];
  const deletes: D[] = [];
  const replaces: R[] = [];
  const unchanged: Un[] = [];

  const isEmpty = (): boolean =>
    creates.length === 0 && updates.length === 0 && deletes.length === 0 && replaces.length === 0;

  return {
    title,
    creates,
    updates,
    deletes,
    replaces,
    unchanged,
    isEmpty,
    print: () => {
      if (isEmpty()) {
        return;
      }
      logger.log(styles.bold(`${title}:`));
      const printItem = (symbol: string, item: HasName) => {
        logger.log(`  ${symbol} ${item.name}`);
        for (const detail of item.details ?? []) {
          logger.log(`    ${detail}`);
        }
      };
      creates.forEach((item) => printItem(symbols.create, item));
      deletes.forEach((item) => printItem(symbols.delete, item));
      updates.forEach((item) => printItem(symbols.update, item));
      replaces.forEach((item) => printItem(symbols.replace, item));
    },
  };
}

/**
 * Summarize resource counts across multiple change sets.
 * @param changeSets - Change sets to aggregate
 * @returns Aggregated plan counts by action
 */
export function summarizeChangeSets(
  changeSets: Array<
    Pick<
      ChangeSet<HasName, HasName, HasName, HasName>,
      "creates" | "updates" | "deletes" | "replaces" | "unchanged"
    >
  >,
): PlanSummary {
  const summary: PlanSummary = {
    create: 0,
    update: 0,
    delete: 0,
    replace: 0,
    unchanged: 0,
  };

  for (const changeSet of changeSets) {
    summary.create += changeSet.creates.length;
    summary.update += changeSet.updates.length;
    summary.delete += changeSet.deletes.length;
    summary.replace += changeSet.replaces.length;
    summary.unchanged += changeSet.unchanged.length;
  }

  return summary;
}

/**
 * Format an aggregated plan summary for CLI output.
 * @param summary - Aggregated plan counts
 * @returns Human-readable plan summary line
 */
export function formatPlanSummary(summary: PlanSummary): string {
  const parts = [
    `${summary.create} to create`,
    `${summary.update} to update`,
    `${summary.delete} to delete`,
  ];

  if (summary.replace > 0) {
    parts.push(`${summary.replace} to replace`);
  }

  return `Plan: ${parts.join(", ")}`;
}
