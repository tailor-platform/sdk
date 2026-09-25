import { styles, symbols } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import {
  forcedBySdkVersionSuffix,
  type ChangeSet,
  type HasName,
  type UpdateAnnotation,
} from "./change-set";
import {
  AUTH_HOOK_PREFIX,
  EXECUTOR_PREFIX,
  RESOLVER_PREFIX,
  WORKFLOW_PREFIX,
} from "./function-registry";

export type DisplayAction = "create" | "update" | "delete" | "replace";

export type GroupedDisplayEntry = UpdateAnnotation & {
  action: DisplayAction;
  symbol: string;
  name: string;
  labels: string[];
  namespace?: string;
};

export type RelatedFunctionRegistryChanges = {
  creates: ReadonlyArray<HasName>;
  updates: ReadonlyArray<HasName & UpdateAnnotation>;
  deletes: ReadonlyArray<HasName>;
  replaces: ReadonlyArray<HasName>;
};

type RelatedFunctionRegistryNameSets = {
  creates: Set<string>;
  updates: Set<string>;
  deletes: Set<string>;
  replaces: Set<string>;
};

function forcedFunctionUpdateNames(changes?: RelatedFunctionRegistryChanges): Set<string> {
  return new Set(
    changes?.updates.filter((item) => item.forcedBySdkVersion).map((item) => item.name) ?? [],
  );
}

function unforcedFunctionChangeNames(changes?: RelatedFunctionRegistryChanges): Set<string> {
  if (!changes) return new Set();
  return new Set(
    [
      ...changes.creates,
      ...changes.deletes,
      ...changes.replaces,
      ...changes.updates.filter((item) => !item.forcedBySdkVersion),
    ].map((item) => item.name),
  );
}

/**
 * Convert grouped function registry changes into mutable name sets.
 * @param changes - Grouped function registry changes
 * @returns Mutable name sets keyed by action
 */
function createRelatedFunctionRegistryNameSets(
  changes?: RelatedFunctionRegistryChanges,
): RelatedFunctionRegistryNameSets {
  return {
    creates: new Set(changes?.creates.map((item) => item.name) ?? []),
    updates: new Set(changes?.updates.map((item) => item.name) ?? []),
    deletes: new Set(changes?.deletes.map((item) => item.name) ?? []),
    replaces: new Set(changes?.replaces.map((item) => item.name) ?? []),
  };
}

export const ACTION_SYMBOLS = {
  create: symbols.create,
  update: symbols.update,
  delete: symbols.delete,
  replace: symbols.replace,
} as const satisfies Record<DisplayAction, string>;

/**
 * Convert a plain change set into grouped display entries.
 * @param changeSet - Change set to convert
 * @param labels - Labels to attach to each entry
 * @param getNamespace - Optional callback to extract namespace from an item
 * @returns Display entries in CLI print order
 */
export function formatChangeSetEntries(
  changeSet: Pick<
    ChangeSet<HasName, HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  labels: string[] = [],
  getNamespace?: (item: HasName) => string | undefined,
): GroupedDisplayEntry[] {
  function toEntry(action: DisplayAction, item: HasName & UpdateAnnotation): GroupedDisplayEntry {
    return {
      action,
      symbol: ACTION_SYMBOLS[action],
      name: item.name,
      labels: [...labels],
      namespace: getNamespace?.(item),
      ...(item.forcedBySdkVersion && { forcedBySdkVersion: true }),
    };
  }
  return [
    ...changeSet.creates.map((item) => toEntry("create", item)),
    ...changeSet.deletes.map((item) => toEntry("delete", item)),
    ...changeSet.updates.map((item) => toEntry("update", item)),
    ...changeSet.replaces.map((item) => toEntry("replace", item)),
  ];
}

function formatGroupedDisplayLine(entry: GroupedDisplayEntry) {
  const line =
    entry.labels.length > 0
      ? `${entry.symbol} ${entry.name} (${entry.labels.join(", ")})`
      : `${entry.symbol} ${entry.name}`;
  return `${line}${forcedBySdkVersionSuffix(entry)}`;
}

function parseFunctionRegistryName(name: string): { displayName: string; namespace?: string } {
  if (name.startsWith(RESOLVER_PREFIX)) {
    const [, namespace, resolverName] = name.split("--");
    if (namespace && resolverName) {
      return { displayName: resolverName, namespace };
    }
  }

  if (name.startsWith(WORKFLOW_PREFIX)) {
    return { displayName: name.slice(WORKFLOW_PREFIX.length) };
  }

  if (name.startsWith(EXECUTOR_PREFIX)) {
    return { displayName: name.slice(EXECUTOR_PREFIX.length) };
  }

  if (name.startsWith(AUTH_HOOK_PREFIX)) {
    const [, namespace, hookPoint] = name.split("--");
    if (namespace && hookPoint) {
      return { displayName: hookPoint, namespace };
    }
  }

  return { displayName: name };
}

/**
 * Build function-registry-only entries that were not grouped with a parent resource.
 * @param names - Related function registry names keyed by action
 * @param forcedUpdates - Function registry update names forced by the SDK version
 * @param consumed - Function registry names already grouped with parent resources
 * @returns Display entries for ungrouped function registry changes
 */
function buildRemainingFunctionRegistryEntries(
  names: RelatedFunctionRegistryNameSets,
  forcedUpdates: ReadonlySet<string>,
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
      .map((name) => {
        const { displayName, namespace } = parseFunctionRegistryName(name);
        return {
          action,
          symbol: ACTION_SYMBOLS[action],
          name: displayName,
          labels: ["function"],
          namespace,
          ...(action === "update" && forcedUpdates.has(name) && { forcedBySdkVersion: true }),
        };
      }),
  );
}

/**
 * Format change set entries with function registry grouping.
 *
 * For each item in creates/updates/deletes, calls `getFunctionRegistryNames` to
 * derive zero or more function registry names. When a matching function registry
 * change exists for the same action, the item is displayed with both the resource
 * label and "function". An update stays forced by the SDK version only when
 * none of its function registry entries has a change that is not itself forced.
 * Ungrouped function registry changes are appended.
 * @param resourceLabel - Label for the resource kind (e.g. "executor", "resolver")
 * @param changeSet - Resource change set with creates/updates/deletes/replaces
 * @param changeSet.creates - Created resources
 * @param changeSet.updates - Updated resources
 * @param changeSet.deletes - Deleted resources
 * @param changeSet.replaces - Replaced resources
 * @param functionRegistryChanges - Related function registry changes
 * @param getFunctionRegistryNames - Derives function registry names from a resource item
 * @param options - Optional display callbacks
 * @param options.getNamespace - Extract namespace from an item for nested display
 * @param options.getDisplayName - Override display name for an item
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
    updates: ReadonlyArray<U & UpdateAnnotation>;
    deletes: ReadonlyArray<D>;
    replaces: ReadonlyArray<HasName>;
  },
  functionRegistryChanges: RelatedFunctionRegistryChanges | undefined,
  getFunctionRegistryNames: (item: C | U | D, action: DisplayAction) => string[],
  options?: {
    getNamespace?: (item: C | U | D) => string | undefined;
    getDisplayName?: (item: C | U | D) => string;
  },
): GroupedDisplayEntry[] {
  const { getNamespace, getDisplayName } = options ?? {};
  const functionNames = createRelatedFunctionRegistryNameSets(functionRegistryChanges);
  const forcedFunctionUpdates = forcedFunctionUpdateNames(functionRegistryChanges);
  const unforcedFunctionChanges = unforcedFunctionChangeNames(functionRegistryChanges);
  const consumed: RelatedFunctionRegistryNameSets = createRelatedFunctionRegistryNameSets();

  function processItems(
    items: ReadonlyArray<(C | U | D) & UpdateAnnotation>,
    action: DisplayAction,
    fnNameSet: Set<string>,
    consumedSet: Set<string>,
  ): GroupedDisplayEntry[] {
    return items.map((item) => {
      const relatedNames = getFunctionRegistryNames(item, action);
      const matchedNames = relatedNames.filter((name) => fnNameSet.has(name));
      for (const name of matchedNames) {
        consumedSet.add(name);
      }
      const forcedBySdkVersion =
        item.forcedBySdkVersion && !relatedNames.some((name) => unforcedFunctionChanges.has(name));
      return {
        action,
        symbol: ACTION_SYMBOLS[action],
        name: getDisplayName?.(item) ?? item.name,
        labels: matchedNames.length > 0 ? [resourceLabel, "function"] : [resourceLabel],
        namespace: getNamespace?.(item),
        ...(forcedBySdkVersion && { forcedBySdkVersion: true }),
      };
    });
  }

  return [
    ...processItems(changeSet.creates, "create", functionNames.creates, consumed.creates),
    ...processItems(changeSet.deletes, "delete", functionNames.deletes, consumed.deletes),
    ...processItems(changeSet.updates, "update", functionNames.updates, consumed.updates),
    ...changeSet.replaces.map((item) => ({
      action: "replace" as const,
      symbol: ACTION_SYMBOLS["replace"],
      name: getDisplayName?.(item as C | U | D) ?? item.name,
      labels: [resourceLabel],
      namespace: getNamespace?.(item as C | U | D),
    })),
    ...buildRemainingFunctionRegistryEntries(functionNames, forcedFunctionUpdates, consumed),
  ];
}

export type NamespaceAction = UpdateAnnotation & {
  name: string;
  action: DisplayAction;
};

/**
 * Extract service-level actions from a change set for namespace header display.
 * @param changeSet - Service change set
 * @returns Array of namespace actions
 */
export function extractServiceActions(
  changeSet: Pick<
    ChangeSet<HasName, HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
): NamespaceAction[] {
  return [
    ...changeSet.creates.map((item) => ({ name: item.name, action: "create" as const })),
    ...changeSet.deletes.map((item) => ({ name: item.name, action: "delete" as const })),
    ...changeSet.updates.map((item): NamespaceAction => ({
      name: item.name,
      action: "update",
      ...(item.forcedBySdkVersion && { forcedBySdkVersion: true }),
    })),
    ...changeSet.replaces.map((item) => ({ name: item.name, action: "replace" as const })),
  ];
}

/**
 * Build display lines for a titled section of grouped entries, nesting by namespace.
 * Service-level changes are shown as the namespace header symbol.
 * Services without child entries are shown as flat entries.
 * @param title - Section title
 * @param entries - Entries to render (should NOT include service entries)
 * @param serviceActions - Optional service-level actions to merge into namespace headers
 * @returns Lines ready for output; empty array when there is nothing to show
 */
export function buildGroupedDisplayLines(
  title: string,
  entries: ReadonlyArray<GroupedDisplayEntry>,
  serviceActions?: ReadonlyArray<NamespaceAction>,
): string[] {
  const serviceMap = new Map<string, NamespaceAction>();
  if (serviceActions) {
    for (const sa of serviceActions) {
      serviceMap.set(sa.name, sa);
    }
  }

  if (entries.length === 0 && serviceMap.size === 0) {
    return [];
  }

  const out: string[] = [styles.bold(`${title}:`)];

  // Group entries by namespace while preserving order
  const namespaceOrder: (string | undefined)[] = [];
  const byNamespace = new Map<string | undefined, GroupedDisplayEntry[]>();
  for (const entry of entries) {
    const ns = entry.namespace;
    if (!byNamespace.has(ns)) {
      namespaceOrder.push(ns);
      byNamespace.set(ns, []);
    }
    assertDefined(byNamespace.get(ns), "namespace group missing").push(entry);
  }

  // Track which services have child entries
  const printedServices = new Set<string>();

  for (const ns of namespaceOrder) {
    const group = assertDefined(byNamespace.get(ns), "namespace group missing");
    if (ns) {
      const svcAction = serviceMap.get(ns);
      const prefix = svcAction ? `${ACTION_SYMBOLS[svcAction.action]} ` : "";
      const header = svcAction?.forcedBySdkVersion
        ? `${styles.bold(ns)}${forcedBySdkVersionSuffix(svcAction)}${styles.bold(":")}`
        : styles.bold(`${ns}:`);
      out.push(`  ${prefix}${header}`);
      printedServices.add(ns);
      for (const entry of group) {
        out.push(`    ${formatGroupedDisplayLine(entry)}`);
      }
    } else {
      for (const entry of group) {
        out.push(`  ${formatGroupedDisplayLine(entry)}`);
      }
    }
  }

  // Append services without child entries as flat entries
  for (const [name, serviceAction] of serviceMap) {
    if (!printedServices.has(name)) {
      out.push(
        `  ${ACTION_SYMBOLS[serviceAction.action]} ${name}${forcedBySdkVersionSuffix(serviceAction)}`,
      );
    }
  }

  return out;
}
