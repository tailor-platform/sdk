import type { SeedContext, SeedNamespaceConfig } from "@tailor-platform/sdk/cli";

/**
 * The name a table goes by in seed data files and on the command line: `<namespace>.<Table>` when
 * several namespaces define its name, else its own name.
 * @param nsConfig - Seed config of the table's namespace
 * @param typeName - Name of the table
 * @returns The table's entity name
 */
export function entityNameOf(nsConfig: SeedNamespaceConfig, typeName: string): string {
  return nsConfig.entityNames?.[typeName] ?? typeName;
}

/**
 * Key a namespace's per-table record by entity name instead of table name.
 * @param nsConfig - Seed config of the namespace
 * @param byTable - Values keyed by table name
 * @returns The same values keyed by entity name
 */
export function keyedByEntityName<T>(
  nsConfig: SeedNamespaceConfig,
  byTable: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(byTable).map(([table, value]) => [entityNameOf(nsConfig, table), value]),
  );
}

/**
 * The entity names of each namespace's tables, in table order.
 * @param context - Seed context of the project
 * @returns Entity names keyed by namespace
 */
export function namespaceEntityNames(
  context: Pick<SeedContext, "namespaces">,
): Record<string, string[]> {
  return Object.fromEntries(
    context.namespaces.map((ns) => [ns.namespace, ns.types.map((type) => entityNameOf(ns, type))]),
  );
}

/**
 * The tables of a namespace that the selected entities name.
 * @param nsConfig - Seed config of the namespace
 * @param entities - Selected entity names, or null for every table
 * @returns Names of the selected tables of the namespace
 */
export function selectedTables(
  nsConfig: SeedNamespaceConfig,
  entities: readonly string[] | null,
): string[] {
  return entities
    ? nsConfig.types.filter((type) => entities.includes(entityNameOf(nsConfig, type)))
    : nsConfig.types;
}
