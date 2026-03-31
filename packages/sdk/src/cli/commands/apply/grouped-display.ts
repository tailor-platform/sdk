import { logger, styles, symbols } from "@/cli/shared/logger";
import type { HasName } from "./change-set";

type HasOptionalDetailLines = HasName & {
  detailLines?: string[];
};

export type DisplayAction = "create" | "update" | "delete" | "replace";

export type GroupedDisplayEntry = {
  action: DisplayAction;
  symbol: string;
  name: string;
  labels: string[];
  detailLines?: string[];
};

export type RelatedFunctionRegistryChanges = {
  creates: ReadonlyArray<HasName>;
  updates: ReadonlyArray<HasName>;
  deletes: ReadonlyArray<HasName>;
  replaces: ReadonlyArray<HasName>;
};

export type RelatedFunctionRegistryNameSets = {
  creates: Set<string>;
  updates: Set<string>;
  deletes: Set<string>;
  replaces: Set<string>;
};

export type PrintableChangeSet = {
  creates: ReadonlyArray<HasOptionalDetailLines>;
  updates: ReadonlyArray<HasOptionalDetailLines>;
  deletes: ReadonlyArray<HasOptionalDetailLines>;
  replaces: ReadonlyArray<HasOptionalDetailLines>;
  isEmpty: () => boolean;
};

/**
 * Convert grouped function registry changes into mutable name sets.
 * @param changes - Grouped function registry changes
 * @returns Mutable name sets keyed by action
 */
export function createRelatedFunctionRegistryNameSets(
  changes?: RelatedFunctionRegistryChanges,
): RelatedFunctionRegistryNameSets {
  return {
    creates: new Set(changes?.creates.map((item) => item.name) ?? []),
    updates: new Set(changes?.updates.map((item) => item.name) ?? []),
    deletes: new Set(changes?.deletes.map((item) => item.name) ?? []),
    replaces: new Set(changes?.replaces.map((item) => item.name) ?? []),
  };
}

/**
 * Resolve the display symbol for a grouped action.
 * @param action - Action kind
 * @returns Styled CLI symbol
 */
export function actionSymbol(action: DisplayAction): string {
  switch (action) {
    case "create":
      return symbols.create;
    case "update":
      return symbols.update;
    case "delete":
      return symbols.delete;
    case "replace":
      return symbols.replace;
    default:
      throw new Error(`Unknown action type: ${action satisfies never}`);
  }
}

/**
 * Format a detail line for a changed script-like field.
 * @param label - Field label to display
 * @returns Styled detail line
 */
export function formatScriptChangedLine(label = "script"): string {
  return styles.update(`${symbols.update} ${label} -> (changed)`);
}

/**
 * Format a detail line for an added script-like field.
 * @param label - Field label to display
 * @returns Styled detail line
 */
export function formatScriptAddedLine(label = "script"): string {
  return styles.create(`${symbols.create} ${label} -> (added)`);
}

/**
 * Format a detail line for a create, update, or delete action.
 * @param action - Change action
 * @param text - Human-readable change text
 * @returns Styled detail line
 */
export function formatActionDetailLine(
  action: "create" | "update" | "delete",
  text: string,
): string {
  switch (action) {
    case "create":
      return styles.create(`${symbols.create} ${text}`);
    case "update":
      return styles.update(`${symbols.update} ${text}`);
    case "delete":
      return styles.delete(`${symbols.delete} ${text}`);
    default:
      throw new Error(`Unknown action type: ${action satisfies never}`);
  }
}

/**
 * Convert a plain change set into grouped display entries.
 * @param changeSet - Change set to convert
 * @param labels - Labels to attach to each entry
 * @returns Display entries in CLI print order
 */
export function formatChangeSetEntries(
  changeSet: Pick<PrintableChangeSet, "creates" | "updates" | "deletes" | "replaces">,
  labels: string[] = [],
): GroupedDisplayEntry[] {
  return [
    ...changeSet.creates.map((item) => ({
      action: "create" as const,
      symbol: actionSymbol("create"),
      name: item.name,
      labels,
      detailLines: item.detailLines,
    })),
    ...changeSet.deletes.map((item) => ({
      action: "delete" as const,
      symbol: actionSymbol("delete"),
      name: item.name,
      labels,
      detailLines: item.detailLines,
    })),
    ...changeSet.updates.map((item) => ({
      action: "update" as const,
      symbol: actionSymbol("update"),
      name: item.name,
      labels,
      detailLines: item.detailLines,
    })),
    ...changeSet.replaces.map((item) => ({
      action: "replace" as const,
      symbol: actionSymbol("replace"),
      name: item.name,
      labels,
      detailLines: item.detailLines,
    })),
  ];
}

function formatGroupedDisplayLine(entry: GroupedDisplayEntry) {
  return entry.labels.length > 0
    ? `${entry.symbol} ${entry.name} (${entry.labels.join(", ")})`
    : `${entry.symbol} ${entry.name}`;
}

/**
 * Print a titled section of grouped display entries.
 * @param title - Section title
 * @param entries - Entries to print
 * @param indent - Leading spaces before the title
 * @param detail - Whether to print entry detail lines
 * @returns True when any entries were printed
 */
export function printGroupedDisplaySection(
  title: string,
  entries: ReadonlyArray<GroupedDisplayEntry>,
  indent = 0,
  detail = false,
) {
  if (entries.length === 0) {
    return false;
  }

  logger.log(styles.bold(`${" ".repeat(indent)}${title}:`));
  const entryIndent = " ".repeat(indent + 2);
  const detailIndent = " ".repeat(indent + 4);
  for (const entry of entries) {
    logger.log(`${entryIndent}${formatGroupedDisplayLine(entry)}`);
    if (detail) {
      entry.detailLines?.forEach((line) => logger.log(`${detailIndent}${line}`));
    }
  }
  return true;
}

function formatFunctionRegistryDisplayName(name: string): string {
  if (name.startsWith("resolver--")) {
    const [, namespace, resolverName] = name.split("--");
    if (namespace && resolverName) {
      return `${namespace}.${resolverName}`;
    }
  }

  if (name.startsWith("workflow--")) {
    return name.slice("workflow--".length);
  }

  if (name.startsWith("executor--")) {
    return name.slice("executor--".length);
  }

  if (name.startsWith("auth-hook--")) {
    const [, namespace, hookPoint] = name.split("--");
    if (namespace && hookPoint) {
      return `${namespace}/${hookPoint}`;
    }
  }

  return name;
}

/**
 * Build function-registry-only entries that were not grouped with a parent resource.
 * @param names - Related function registry names keyed by action
 * @param consumed - Function registry names already grouped with parent resources
 * @returns Display entries for ungrouped function registry changes
 */
export function buildRemainingFunctionRegistryEntries(
  names: RelatedFunctionRegistryNameSets,
  consumed: RelatedFunctionRegistryNameSets = createRelatedFunctionRegistryNameSets(),
): GroupedDisplayEntry[] {
  return [
    ...[...names.creates]
      .filter((name) => !consumed.creates.has(name))
      .map((name) => ({
        action: "create" as const,
        symbol: actionSymbol("create"),
        name: formatFunctionRegistryDisplayName(name),
        labels: ["functionRegistry"],
      })),
    ...[...names.deletes]
      .filter((name) => !consumed.deletes.has(name))
      .map((name) => ({
        action: "delete" as const,
        symbol: actionSymbol("delete"),
        name: formatFunctionRegistryDisplayName(name),
        labels: ["functionRegistry"],
      })),
    ...[...names.updates]
      .filter((name) => !consumed.updates.has(name))
      .map((name) => ({
        action: "update" as const,
        symbol: actionSymbol("update"),
        name: formatFunctionRegistryDisplayName(name),
        labels: ["functionRegistry"],
      })),
    ...[...names.replaces]
      .filter((name) => !consumed.replaces.has(name))
      .map((name) => ({
        action: "replace" as const,
        symbol: actionSymbol("replace"),
        name: formatFunctionRegistryDisplayName(name),
        labels: ["functionRegistry"],
      })),
  ];
}
