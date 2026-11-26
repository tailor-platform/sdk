import type {
  TailorDBReplicationDestinationConfig,
  TailorDBReplicationDestinationServiceInput,
} from "./types";
export type {
  TailorDBPluginTableConfig,
  TailorDBPluginTablesConfig,
  TailorDBReplicationConfig,
  TailorDBReplicationDestinationConfig,
  TailorDBReplicationsConfig,
  TailorDBTableReplication,
} from "./types";

/**
 * Define a BigQuery dataset that TailorDB replications write into.
 *
 * A replication that names the destination deploys it. Creating the first destination of a
 * workspace issues the workspace's replication service account, which `tailor deploy` prints.
 * Grant it access to the dataset before replications can write to it.
 * @param name - Destination name
 * @param config - Destination configuration
 * @returns Defined replication destination
 * @example
 * const warehouse = defineTailorDBReplicationDestination("warehouse", {
 *   bigquery: { project: "acme-analytics", dataset: "tailor" },
 * });
 *
 * export default defineConfig({
 *   name: "shop",
 *   db: {
 *     "main-db": {
 *       files: ["./tailordb/*.ts"],
 *       replications: { analytics: { destination: warehouse, tablePrefix: "shop_" } },
 *     },
 *   },
 * });
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineTailorDBReplicationDestination(
  name: string,
  config: TailorDBReplicationDestinationServiceInput,
) {
  const result = { ...config, name };
  return result as typeof result & TailorDBReplicationDestinationConfig;
}
