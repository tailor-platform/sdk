export interface SelectEntitiesOptions {
  /** Table names per TailorDB namespace. */
  namespaceTables: Record<string, string[]>;
  /** Whether the config seeds IdP `_User` records. */
  hasIdpUser: boolean;
  /** Namespace filter (mutually exclusive with `entities`). */
  namespace?: string | undefined;
  /** Explicit entity names to process (mutually exclusive with `namespace`). */
  entities: string[];
  /** Whether to exclude the IdP `_User` entity. */
  skipIdp: boolean;
}

export interface EntitySelection {
  /** Entities to process, or null when everything is processed. */
  entitiesToProcess: string[] | null;
  /** Whether the resolved selection contains at least one entity. */
  hasEntitiesToProcess: boolean;
  /** Non-fatal notes about the selection (e.g. redundant flags). */
  warnings: string[];
}

/**
 * Resolve which entities a seed run should process from the namespace/entity
 * filters, mirroring the selection rules of the generated seed script.
 * @param options - Selection filters and available entities
 * @returns The resolved selection and any warnings
 */
export function selectEntities(options: SelectEntitiesOptions): EntitySelection {
  const { namespaceTables, hasIdpUser, namespace, entities, skipIdp } = options;
  const tables = Object.values(namespaceTables).flat();
  const allEntities = hasIdpUser ? [...tables, "_User"] : tables;
  const warnings: string[] = [];

  if (namespace && entities.length > 0) {
    throw new Error("Options --namespace and entity names are mutually exclusive.");
  }

  if (skipIdp && namespace) {
    warnings.push(
      "--skip-idp is redundant with --namespace (namespace filtering already excludes _User).",
    );
  }

  let entitiesToProcess: string[] | null = null;

  if (namespace) {
    const tablesInNamespace = namespaceTables[namespace];
    if (!tablesInNamespace || tablesInNamespace.length === 0) {
      const available = Object.keys(namespaceTables).join(", ");
      throw new Error(
        `No entities found in namespace "${namespace}". Available namespaces: ${available}`,
      );
    }
    entitiesToProcess = tablesInNamespace;
  }

  if (entities.length > 0) {
    const notFoundEntities = entities.filter((entity) => !allEntities.includes(entity));
    if (notFoundEntities.length > 0) {
      throw new Error(
        `The following entities were not found: ${notFoundEntities.join(", ")}. ` +
          `Available entities: ${allEntities.join(", ")}`,
      );
    }
    entitiesToProcess = entities;
  }

  if (skipIdp) {
    entitiesToProcess = (entitiesToProcess ?? tables).filter((entity) => entity !== "_User");
  }

  return {
    entitiesToProcess,
    hasEntitiesToProcess: (entitiesToProcess ?? allEntities).length > 0,
    warnings,
  };
}
