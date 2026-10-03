import type { TailorDBServiceInput } from "#/configure/services/tailordb/types";
import type { NormalizedDb } from "#/types/app-config.generated";

/**
 * Normalize namespace ownership, subgraph membership, and definition sources.
 * @param db - Configured TailorDB namespaces
 * @returns Normalized namespaces in config order
 */
export function normalizeDb(db: TailorDBServiceInput | undefined): NormalizedDb {
  return Object.fromEntries(
    Object.entries(db ?? {}).map(([namespace, entry]) => [
      namespace,
      "external" in entry
        ? { owned: false, inSubgraph: true, schemaSource: undefined }
        : {
            owned: true,
            inSubgraph: true,
            schemaSource: { kind: "files", config: entry },
          },
    ]),
  );
}
