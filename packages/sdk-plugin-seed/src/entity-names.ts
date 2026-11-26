import { existsSync, readFileSync } from "node:fs";
import * as path from "pathe";
import type { SeedContext, SeedNamespaceConfig } from "@tailor-platform/sdk/cli";

/**
 * The name a table goes by in seed data files and on the command line: `<namespace>.<Table>` when
 * several namespaces define its name, else its own name.
 * @param namespace - Seed config of the table's namespace
 * @param typeName - Name of the table
 * @returns The table's entity name
 */
export function entityNameOf(namespace: SeedNamespaceConfig, typeName: string): string {
  return namespace.entityNames?.[typeName] ?? typeName;
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
 * @param namespace - Seed config of the namespace
 * @param entities - Selected entity names, or null for every table
 * @returns Names of the selected tables of the namespace
 */
export function selectedTables(
  namespace: SeedNamespaceConfig,
  entities: readonly string[] | null,
): string[] {
  return entities
    ? namespace.types.filter((type) => entities.includes(entityNameOf(namespace, type)))
    : namespace.types;
}

/**
 * Reject a data file named after a table that several namespaces define: its rows belong to one of
 * the files named after each namespace's table, and seeding would leave them out.
 * @param context - Seed context of the project
 * @param dataDir - Directory holding the seed data files
 */
export function assertNoSharedTableFileUnderItsOwnName(
  context: Pick<SeedContext, "namespaces">,
  dataDir: string,
): void {
  const entitiesByTable = new Map<string, string[]>();
  for (const ns of context.namespaces) {
    for (const [table, entity] of Object.entries(ns.entityNames ?? {})) {
      entitiesByTable.set(table, [...(entitiesByTable.get(table) ?? []), entity]);
    }
  }
  for (const [table, entities] of entitiesByTable) {
    const file = path.join(dataDir, `${table}.jsonl`);
    if (existsSync(file) && readFileSync(file, "utf8").trim() !== "") {
      throw new Error(
        `${file} holds rows for table "${table}", which several namespaces define. ` +
          `Move each row to the data file of its namespace's table: ${entities.map((entity) => `${entity}.jsonl`).join(", ")}.`,
      );
    }
  }
}
