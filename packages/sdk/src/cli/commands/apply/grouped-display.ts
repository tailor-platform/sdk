import { symbols } from "@/cli/shared/logger";
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
