import { type ChangeSet, type HasName } from "../change-set";
import { ACTION_SYMBOLS, type DisplayAction, type GroupedDisplayEntry } from "../grouped-display";

type TailorDBDisplayEntry = GroupedDisplayEntry;

type NamespacedItem = HasName & { request?: { namespaceName?: string } };

function itemKey(item: NamespacedItem): string {
  return `${item.request?.namespaceName ?? ""}/${item.name}`;
}

function collectTailorDBDisplayEntries(
  action: DisplayAction,
  typeItems: ReadonlyArray<NamespacedItem>,
  gqlPermissionItems: ReadonlyArray<NamespacedItem>,
): TailorDBDisplayEntry[] {
  const typeKeys = new Set(typeItems.map(itemKey));
  const gqlPermissionKeys = new Set(gqlPermissionItems.map(itemKey));
  const typeEntries = typeItems.map((item) => ({
    action,
    symbol: ACTION_SYMBOLS[action],
    name: item.name,
    labels: gqlPermissionKeys.has(itemKey(item)) ? ["table", "gqlPermission"] : ["table"],
    namespace: item.request?.namespaceName,
  }));
  const gqlPermissionOnlyEntries = gqlPermissionItems
    .filter((item) => !typeKeys.has(itemKey(item)))
    .map((item) => ({
      action,
      symbol: ACTION_SYMBOLS[action],
      name: item.name,
      labels: ["gqlPermission"],
      namespace: item.request?.namespaceName,
    }));

  return [...typeEntries, ...gqlPermissionOnlyEntries];
}

/**
 * Format TailorDB table and gqlPermission changes as grouped dry-run entries.
 * @param typeChangeSet - TailorDB table changes
 * @param gqlPermissionChangeSet - TailorDB gqlPermission changes
 * @returns Display entries for TailorDB resource output
 */
export function formatTailorDBResourceChangeEntries(
  typeChangeSet: Pick<
    ChangeSet<HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  gqlPermissionChangeSet: Pick<
    ChangeSet<HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
): TailorDBDisplayEntry[] {
  return [
    ...collectTailorDBDisplayEntries(
      "create",
      typeChangeSet.creates,
      gqlPermissionChangeSet.creates,
    ),
    ...collectTailorDBDisplayEntries(
      "delete",
      typeChangeSet.deletes,
      gqlPermissionChangeSet.deletes,
    ),
    ...collectTailorDBDisplayEntries(
      "update",
      typeChangeSet.updates,
      gqlPermissionChangeSet.updates,
    ),
    ...collectTailorDBDisplayEntries(
      "replace",
      typeChangeSet.replaces,
      gqlPermissionChangeSet.replaces,
    ),
  ];
}
