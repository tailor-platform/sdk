import { styles, symbols } from "#/cli/shared/logger";

export interface HasName {
  name: string;
  /**
   * Optional pre-formatted lines rendered indented beneath the item by
   * `ChangeSet.lines()` (e.g. per-sub-resource diffs embedded in a single
   * resource).
   */
  details?: readonly string[];
}

/**
 * Marks an update whose config the current SDK found unchanged, so it is
 * planned only because the resource was last applied by a different SDK
 * version.
 */
export type UpdateAnnotation = { forcedBySdkVersion?: true };

/**
 * Render the plan-line suffix that marks an update forced by the SDK version.
 * @param item - Plan item that may carry the annotation
 * @returns Suffix to append to the item's line, or an empty string
 */
export function forcedBySdkVersionSuffix(item: UpdateAnnotation): string {
  return item.forcedBySdkVersion ? ` ${styles.dim("[forced by SDK version]")}` : "";
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
  readonly updates: Array<U & UpdateAnnotation>;
  readonly deletes: D[];
  readonly replaces: R[];
  readonly unchanged: Un[];
  isEmpty: () => boolean;
  lines: () => string[];
};

export interface PlanSummary {
  create: number;
  update: number;
  delete: number;
  replace: number;
  /** Updates, also counted in `update`, that are forced by the SDK version. */
  forcedBySdkVersion: number;
}

/**
 * Create a new ChangeSet for tracking resource changes.
 * @param title - Title for the change set
 * @returns Empty ChangeSet instance with isEmpty() and lines() methods
 */
export function createChangeSet<
  C extends HasName,
  U extends HasName,
  D extends HasName,
  R extends HasName = never,
  Un extends HasName = HasName,
>(title: string): ChangeSet<C, U, D, R, Un> {
  const creates: C[] = [];
  const updates: Array<U & UpdateAnnotation> = [];
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
    lines: () => {
      if (isEmpty()) return [];
      const itemLines = (symbol: string) => (item: HasName & UpdateAnnotation) => [
        `  ${symbol} ${item.name}${forcedBySdkVersionSuffix(item)}`,
        ...(item.details ?? []).map((d) => `    ${d}`),
      ];
      return [
        styles.bold(`${title}:`),
        ...creates.flatMap(itemLines(symbols.create)),
        ...deletes.flatMap(itemLines(symbols.delete)),
        ...updates.flatMap(itemLines(symbols.update)),
        ...replaces.flatMap(itemLines(symbols.replace)),
      ];
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
      "creates" | "updates" | "deletes" | "replaces"
    >
  >,
): PlanSummary {
  const summary: PlanSummary = {
    create: 0,
    update: 0,
    delete: 0,
    replace: 0,
    forcedBySdkVersion: 0,
  };

  for (const changeSet of changeSets) {
    summary.create += changeSet.creates.length;
    summary.update += changeSet.updates.length;
    summary.delete += changeSet.deletes.length;
    summary.replace += changeSet.replaces.length;
    summary.forcedBySdkVersion += changeSet.updates.filter(
      (item) => item.forcedBySdkVersion,
    ).length;
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
    summary.forcedBySdkVersion > 0
      ? `${summary.update} to update (${summary.forcedBySdkVersion} forced by SDK version)`
      : `${summary.update} to update`,
    `${summary.delete} to delete`,
  ];

  if (summary.replace > 0) {
    parts.push(`${summary.replace} to replace`);
  }

  return `Plan: ${parts.join(", ")}`;
}
