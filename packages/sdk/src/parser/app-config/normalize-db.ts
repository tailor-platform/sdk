import type { NormalizedDb } from "#/types/app-config.generated";
import type { NormalizedAppConfig } from "./types";

/**
 * Normalize namespace ownership, subgraph membership, and definition sources.
 * @param db - Configured TailorDB namespaces
 * @returns Normalized namespaces in config order
 */
export function normalizeDb(db: NormalizedAppConfig["db"]): NormalizedDb {
  return Object.fromEntries(
    Object.entries(db ?? {}).map(([namespace, entry]) => [
      namespace,
      entry.files !== undefined
        ? {
            owned: true,
            inSubgraph: true,
            schemaSource: { kind: "files", config: entry },
          }
        : {
            owned: false,
            inSubgraph: entry.attach === true,
            schemaSource:
              entry.schemaFrom === undefined
                ? undefined
                : { kind: "config", path: entry.schemaFrom },
          },
    ]),
  );
}
