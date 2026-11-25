import type { TailorDBReplicationTypeInput } from "#/types/tailordb-replication.generated";
import type {
  TailorDBReplicationConfig,
  TailorDBReplicationDestinationConfig,
  TailorDBReplicationDestinationServiceInput,
  TailorDBReplicationServiceInput,
} from "./types";
export type {
  TailorDBReplicationConfig,
  TailorDBReplicationDestinationConfig,
  TailorDBReplicationTypeOptions,
} from "./types";

/**
 * Define a BigQuery dataset that TailorDB replications write into.
 *
 * Creating the first destination of a workspace issues the workspace's
 * replication service account, which `tailor deploy` prints. Grant it access to
 * the dataset before replications can write to it.
 * @param name - Destination name
 * @param config - Destination configuration
 * @returns Defined replication destination
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineTailorDBReplicationDestination(
  name: string,
  config: TailorDBReplicationDestinationServiceInput,
) {
  const result = { ...config, name };
  return result as typeof result & TailorDBReplicationDestinationConfig;
}

type ReplicatedTable = { name: string };

function createReplication(
  settings: TailorDBReplicationServiceInput & { name: string },
  types: TailorDBReplicationTypeInput[],
): TailorDBReplicationConfig {
  const replication = {
    ...settings,
    types,
    add(type: ReplicatedTable, options: Omit<TailorDBReplicationTypeInput, "name"> = {}) {
      const added: TailorDBReplicationTypeInput = { name: type.name };
      if (options.excludeFields) added.excludeFields = [...options.excludeFields];
      if (options.includeFields) added.includeFields = [...options.includeFields];
      return createReplication(settings, [...types, added]);
    },
  };
  Object.defineProperty(replication, "add", { enumerable: false });
  return replication as TailorDBReplicationConfig;
}

/**
 * Define a replication of TailorDB types into a replication destination.
 * Add each type to replicate with `.add()`, which returns a new replication.
 * @param name - Replication name
 * @param config - Replication configuration
 * @returns Defined replication with no types
 * @example
 * const analytics = defineTailorDBReplication("analytics", {
 *   source: { namespace: "main-db" },
 *   destination: "warehouse",
 * })
 *   .add(user, { excludeFields: ["email"] })
 *   .add(order);
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineTailorDBReplication(
  name: string,
  config: TailorDBReplicationServiceInput,
): TailorDBReplicationConfig {
  return createReplication({ ...config, name }, []);
}
