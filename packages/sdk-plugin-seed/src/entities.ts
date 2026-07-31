export interface SelectEntitiesOptions {
  /** Type names per TailorDB namespace. */
  namespaceEntities: Record<string, string[]>;
  /** Whether the config seeds IdP `_User` records. */
  hasIdpUser: boolean;
  /** Namespace filter (mutually exclusive with `types`). */
  namespace?: string | undefined;
  /** Explicit type names to process (mutually exclusive with `namespace`). */
  types: string[];
  /** Whether to exclude the IdP `_User` entity. */
  skipIdp: boolean;
}

export interface EntitySelection {
  /** Types to process, or null when everything is processed. */
  entitiesToProcess: string[] | null;
  /** Whether the resolved selection contains at least one entity. */
  hasEntitiesToProcess: boolean;
  /** Non-fatal notes about the selection (e.g. redundant flags). */
  warnings: string[];
}

/**
 * Resolve which entities a seed run should process from the namespace/type
 * filters, mirroring the selection rules of the generated seed script.
 * @param options - Selection filters and available entities
 * @returns The resolved selection and any warnings
 */
export function selectEntities(options: SelectEntitiesOptions): EntitySelection {
  const { namespaceEntities, hasIdpUser, namespace, types, skipIdp } = options;
  const entities = Object.values(namespaceEntities).flat();
  const allEntities = hasIdpUser ? [...entities, "_User"] : entities;
  const warnings: string[] = [];

  if (namespace && types.length > 0) {
    throw new Error("Options --namespace and type names are mutually exclusive.");
  }

  if (skipIdp && namespace) {
    warnings.push(
      "--skip-idp is redundant with --namespace (namespace filtering already excludes _User).",
    );
  }

  let entitiesToProcess: string[] | null = null;

  if (namespace) {
    const namespaceTypes = namespaceEntities[namespace];
    if (!namespaceTypes || namespaceTypes.length === 0) {
      const available = Object.keys(namespaceEntities).join(", ");
      throw new Error(
        `No entities found in namespace "${namespace}". Available namespaces: ${available}`,
      );
    }
    entitiesToProcess = namespaceTypes;
  }

  if (types.length > 0) {
    const notFoundTypes = types.filter((type) => !allEntities.includes(type));
    if (notFoundTypes.length > 0) {
      throw new Error(
        `The following types were not found: ${notFoundTypes.join(", ")}. ` +
          `Available types: ${allEntities.join(", ")}`,
      );
    }
    entitiesToProcess = types;
  }

  if (skipIdp) {
    entitiesToProcess = (entitiesToProcess ?? entities).filter((entity) => entity !== "_User");
  }

  return {
    entitiesToProcess,
    hasEntitiesToProcess: (entitiesToProcess ?? allEntities).length > 0,
    warnings,
  };
}
