/**
 * Plugin utilities for creating reusable plugins.
 */

export {
  withPluginContext,
  type PluginDBSchema,
  type PluginExecutorFactory,
  type PluginFunctionArgs,
  type PluginRecord,
  type PluginRecordCreatedArgs,
  type PluginRecordDeletedArgs,
  type PluginRecordUpdatedArgs,
} from "./with-context";

export { getExtendedTable, getGeneratedTable } from "./get-generated-table";

export type { PluginConfigRegistry } from "./types";

export { generateSchemaDDL, type DDLFieldConfig, type DDLTableConfig } from "#/utils/tailordb-ddl";
export { toDDLTables } from "./builtin/kysely-type/pglite-schema";
