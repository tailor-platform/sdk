import { logger, styles, symbols } from "@/cli/shared/logger";
import type { HasName } from "./change-set";

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
 * Build function-registry-only entries that were not grouped with a parent resource.
 * @param names - Related function registry names keyed by action
 * @param consumed - Function registry names already grouped with parent resources
 * @returns Display entries for ungrouped function registry changes
 */
export function buildRemainingFunctionRegistryEntries(
  names: RelatedFunctionRegistryNameSets,
  consumed: RelatedFunctionRegistryNameSets = createRelatedFunctionRegistryNameSets(),
): GroupedDisplayEntry[] {
  const actions = [
    ["create", names.creates, consumed.creates],
    ["delete", names.deletes, consumed.deletes],
    ["update", names.updates, consumed.updates],
    ["replace", names.replaces, consumed.replaces],
  ] as const;

  return actions.flatMap(([action, nameSet, consumedSet]) =>
    [...nameSet]
      .filter((name) => !consumedSet.has(name))
      .map((name) => ({
        action,
        symbol: actionSymbol(action),
        name,
        labels: ["functionRegistry"],
      })),
  );
}

/**
 * Format change set entries with function registry grouping.
 *
 * For each item in creates/updates/deletes, calls `getFunctionRegistryNames` to
 * derive zero or more function registry names. When a matching function registry
 * change exists for the same action, the item is displayed with both the resource
 * label and "functionRegistry". Ungrouped function registry changes are appended.
 * @param resourceLabel - Label for the resource kind (e.g. "executor", "resolver")
 * @param changeSet - Resource change set with creates/updates/deletes/replaces
 * @param changeSet.creates - Created resources
 * @param changeSet.updates - Updated resources
 * @param changeSet.deletes - Deleted resources
 * @param changeSet.replaces - Replaced resources
 * @param functionRegistryChanges - Related function registry changes
 * @param getFunctionRegistryNames - Derives function registry names from a resource item
 * @returns Display entries for CLI output
 */
export function formatChangeEntriesWithFunctionRegistry<
  C extends HasName,
  U extends HasName,
  D extends HasName,
>(
  resourceLabel: string,
  changeSet: {
    creates: ReadonlyArray<C>;
    updates: ReadonlyArray<U>;
    deletes: ReadonlyArray<D>;
    replaces: ReadonlyArray<HasName>;
  },
  functionRegistryChanges: RelatedFunctionRegistryChanges | undefined,
  getFunctionRegistryNames: (item: C | U | D, action: DisplayAction) => string[],
): GroupedDisplayEntry[] {
  const functionNames = createRelatedFunctionRegistryNameSets(functionRegistryChanges);
  const consumed: RelatedFunctionRegistryNameSets = createRelatedFunctionRegistryNameSets();

  function processItems(
    items: ReadonlyArray<C | U | D>,
    action: DisplayAction,
    fnNameSet: Set<string>,
    consumedSet: Set<string>,
  ): GroupedDisplayEntry[] {
    return items.map((item) => {
      const names = getFunctionRegistryNames(item, action);
      const hasMatch = names.some((name) => fnNameSet.has(name));
      if (hasMatch) {
        for (const name of names) {
          if (fnNameSet.has(name)) {
            consumedSet.add(name);
          }
        }
      }
      return {
        action,
        symbol: actionSymbol(action),
        name: item.name,
        labels: hasMatch ? [resourceLabel, "functionRegistry"] : [resourceLabel],
      };
    });
  }

  return [
    ...processItems(changeSet.creates, "create", functionNames.creates, consumed.creates),
    ...processItems(changeSet.deletes, "delete", functionNames.deletes, consumed.deletes),
    ...processItems(changeSet.updates, "update", functionNames.updates, consumed.updates),
    ...changeSet.replaces.map((item) => ({
      action: "replace" as const,
      symbol: actionSymbol("replace"),
      name: item.name,
      labels: [resourceLabel],
    })),
    ...buildRemainingFunctionRegistryEntries(functionNames, consumed),
  ];
}

/**
 * Print a titled section of grouped display entries.
 * @param title - Section title
 * @param entries - Entries to print
 */
export function printGroupedDisplaySection(
  title: string,
  entries: ReadonlyArray<GroupedDisplayEntry>,
) {
  if (entries.length === 0) {
    return;
  }

  logger.log(styles.bold(`${title}:`));
  for (const entry of entries) {
    const line =
      entry.labels.length > 0
        ? `  ${entry.symbol} ${entry.name} (${entry.labels.join(", ")})`
        : `  ${entry.symbol} ${entry.name}`;
    logger.log(line);
  }
}
