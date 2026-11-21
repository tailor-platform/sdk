import * as fs from "node:fs";
import * as path from "pathe";
import { toLoadedWorkspaceConfig, type LoadedWorkspaceConfig } from "#/cli/shared/config-loader";
import { internalError } from "#/cli/shared/errors";
import { parseConfigExport } from "#/parser/app-config/config-export";

/**
 * Parse the value of a `defineWorkspace()` or `defineApp()` call as the config loader does, without
 * a config file.
 * @param config - Value returned by `defineWorkspace()` or `defineApp()`
 * @param configPath - Path the loaded workspace reports as its config file
 * @returns The loaded workspace
 */
export function loadedWorkspace(
  config: unknown,
  configPath = "/project/tailor.config.ts",
): LoadedWorkspaceConfig {
  const parsed = parseConfigExport(config);
  if (!parsed.success || parsed.data.kind !== "workspace") {
    throw internalError("expected a valid workspace config");
  }
  return toLoadedWorkspaceConfig(parsed.data, configPath);
}

/**
 * Source of a config module whose default export carries the mark `defineWorkspace()` or
 * `defineApp()` gives it, for config files that cannot import those functions from the build.
 * @param kind - `"workspace-config"` for `defineWorkspace()`, `"app-config"` for `defineApp()`
 * @param source - Source of the object to export
 * @returns Source of the default export
 */
export function brandedDefault(kind: "workspace-config" | "app-config", source: string): string {
  return `export default Object.defineProperty(${source}, Symbol.for("tailor-platform/sdk"), { value: ${JSON.stringify(kind)} });`;
}

const WORKSPACE_TABLES = [
  ["customer", "Customer"],
  ["order", "Order"],
  ["ledger", "Entry"],
] as const;

/**
 * Source of a workspace's `db`: `customer-db` and `order-db`, which an application can list, and
 * `ledger-db`, reading the tables {@link writeWorkspaceTables} writes.
 */
export const WORKSPACE_DB_SOURCE = `{
    "customer-db": { files: ["./db/customer/*.ts"] },
    "order-db": { files: ["./db/order/*.ts"] },
    "ledger-db": { files: ["./db/ledger/*.ts"] },
  }`;

/**
 * Write one table into each namespace of {@link WORKSPACE_DB_SOURCE}.
 * @param dir - Directory of the config file
 * @param tableSource - Source of a table module, given the table's name
 */
export function writeWorkspaceTables(dir: string, tableSource: (name: string) => string): void {
  for (const [namespace, table] of WORKSPACE_TABLES) {
    fs.mkdirSync(path.join(dir, "db", namespace), { recursive: true });
    fs.writeFileSync(path.join(dir, "db", namespace, "table.ts"), tableSource(table));
  }
}
