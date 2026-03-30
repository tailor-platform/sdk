import { logger, styles, symbols } from "@/cli/shared/logger";
import type { ChangeSet, HasName } from "./change-set";

export type DisplayAction = "create" | "update" | "delete" | "replace";

export type GroupedDisplayEntry = {
  action: DisplayAction;
  symbol: string;
  name: string;
  labels: string[];
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

export type PrintableChangeSet = Pick<
  ChangeSet<HasName, HasName, HasName, HasName>,
  "creates" | "updates" | "deletes" | "replaces" | "isEmpty"
>;

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
    })),
    ...changeSet.deletes.map((item) => ({
      action: "delete" as const,
      symbol: actionSymbol("delete"),
      name: item.name,
      labels,
    })),
    ...changeSet.updates.map((item) => ({
      action: "update" as const,
      symbol: actionSymbol("update"),
      name: item.name,
      labels,
    })),
    ...changeSet.replaces.map((item) => ({
      action: "replace" as const,
      symbol: actionSymbol("replace"),
      name: item.name,
      labels,
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
 * @returns True when any entries were printed
 */
export function printGroupedDisplaySection(
  title: string,
  entries: ReadonlyArray<GroupedDisplayEntry>,
  indent = 0,
) {
  if (entries.length === 0) {
    return false;
  }

  logger.log(styles.bold(`${" ".repeat(indent)}${title}:`));
  const entryIndent = " ".repeat(indent + 2);
  for (const entry of entries) {
    logger.log(`${entryIndent}${formatGroupedDisplayLine(entry)}`);
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
