import { fetchAll, isNotFoundError } from "#/cli/shared/client";
import { assertUniqueDefinitionNames } from "#/cli/shared/validation-errors";
import { isPluginGeneratedTable } from "#/parser/service/tailordb/type-source";
import type { TypeSourceInfo, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";

type LocalTailorDBService = {
  readonly namespace: string;
  readonly types: Readonly<Record<string, unknown>>;
  readonly typeSourceInfo: Readonly<TypeSourceInfo>;
};

type TailorDBTypeNameSourceKind = "local" | "external";

export type TailorDBTypeNameSource = {
  readonly namespace: string;
  readonly tableName: string;
  readonly kind: TailorDBTypeNameSourceKind;
  readonly definition?: TailorDBTypeDefinitionSource;
};

type ListTailorDBTypesArgs = {
  workspaceId: string;
  namespaceName: string;
  pageToken?: string;
  pageSize?: number;
};

type ListTailorDBTypesResult = {
  tailordbTypes: Array<{ name: string }>;
  nextPageToken?: string;
};

type ListTailorDBTypesClient = {
  listTailorDBTypes(args: ListTailorDBTypesArgs): Promise<ListTailorDBTypesResult>;
};

export interface CollectLocalTailorDBTypeNameSourcesArgs {
  /** Loaded local TailorDB services. */
  tailorDBServices: ReadonlyArray<LocalTailorDBService>;
}

export interface FetchExternalTailorDBTypeNameSourcesArgs {
  /** Client used to read TailorDB metadata. */
  client: ListTailorDBTypesClient;
  /** Workspace that owns the configured namespaces. */
  workspaceId: string;
  /** External TailorDB namespaces declared in the application config. */
  externalTailorDBNamespaces: ReadonlyArray<string>;
}

interface AssertUniqueTailorDBTypeNamesArgs {
  /** Table-name sources to validate. */
  sources: ReadonlyArray<TailorDBTypeNameSource>;
}

export interface AssertUniqueTailorDBTypeNamesWithExternalArgs
  extends CollectLocalTailorDBTypeNameSourcesArgs, FetchExternalTailorDBTypeNameSourcesArgs {
  /** External TailorDB services planned in the same deploy run. */
  plannedExternalTailorDBServices?: ReadonlyArray<LocalTailorDBService>;
}

export interface TailorDBTypeDefinitionSource {
  /** File that defines the table, or the table a plugin generated it from. */
  file?: string;
  /** Export of `file` that defines the table, or the table a plugin generated it from. */
  exportName?: string;
  /** The plugin that generated the table, when one did. */
  source?: string;
}

/**
 * Describe where a TailorDB table is defined, for a duplicate-name error.
 * @param sourceInfo - Source information captured when loading the table
 * @returns The defining file and export, and the plugin that generated the table when one did
 */
export function tailorDBTypeDefinitionSource(
  sourceInfo: TypeSourceInfoEntry | undefined,
): TailorDBTypeDefinitionSource {
  if (!sourceInfo) {
    return {};
  }

  if (isPluginGeneratedTable(sourceInfo)) {
    const parts = [`plugin ${sourceInfo.pluginId}`];
    if (sourceInfo.generatedTableKind) {
      parts.push(`kind ${sourceInfo.generatedTableKind}`);
    }
    return {
      file: sourceInfo.originalFilePath || undefined,
      exportName: sourceInfo.originalExportName || undefined,
      source: parts.join(", "),
    };
  }

  return { file: sourceInfo.filePath, exportName: sourceInfo.exportName };
}

/**
 * Format a TailorDB table source for validation errors.
 * @param sourceInfo - Source information captured when loading the table
 * @returns Human-readable source detail
 */
export function formatTailorDBTypeSourceInfo(
  sourceInfo: TypeSourceInfoEntry | undefined,
): string | undefined {
  if (!sourceInfo) {
    return undefined;
  }

  if (isPluginGeneratedTable(sourceInfo)) {
    const parts = [`plugin ${sourceInfo.pluginId}`];
    if (sourceInfo.generatedTableKind) {
      parts.push(`kind ${sourceInfo.generatedTableKind}`);
    }
    if (sourceInfo.originalFilePath) {
      parts.push(`source ${sourceInfo.originalFilePath}`);
    }
    if (sourceInfo.originalExportName) {
      parts.push(`export ${sourceInfo.originalExportName}`);
    }
    return parts.join(", ");
  }

  return `${sourceInfo.filePath} export ${sourceInfo.exportName}`;
}

/**
 * Collect TailorDB table-name sources from loaded local services.
 * @param args - Collection inputs
 * @returns Table-name sources for local services
 */
function collectLocalTailorDBTypeNameSources(
  args: CollectLocalTailorDBTypeNameSourcesArgs,
): TailorDBTypeNameSource[] {
  const sources: TailorDBTypeNameSource[] = [];

  for (const service of args.tailorDBServices) {
    for (const tableName of Object.keys(service.types)) {
      sources.push({
        namespace: service.namespace,
        tableName,
        kind: "local",
        definition: tailorDBTypeDefinitionSource(service.typeSourceInfo[tableName]),
      });
    }
  }

  return sources;
}

/**
 * Fetch TailorDB table-name sources for external namespaces.
 * @param args - Fetch inputs
 * @returns Table-name sources for external services
 */
export async function fetchExternalTailorDBTypeNameSources(
  args: FetchExternalTailorDBTypeNameSourcesArgs,
): Promise<TailorDBTypeNameSource[]> {
  const sourcesByNamespace = await Promise.all(
    args.externalTailorDBNamespaces.map(async (namespace) => {
      const sources: TailorDBTypeNameSource[] = [];
      const tailordbTypes = await fetchAll(async (pageToken, maxPageSize) => {
        try {
          const { tailordbTypes, nextPageToken } = await args.client.listTailorDBTypes({
            workspaceId: args.workspaceId,
            namespaceName: namespace,
            pageToken,
            pageSize: maxPageSize,
          });
          return [tailordbTypes, nextPageToken ?? ""];
        } catch (error) {
          if (isNotFoundError(error)) {
            return [[], ""];
          }
          throw error;
        }
      });

      for (const type of tailordbTypes) {
        sources.push({
          namespace,
          tableName: type.name,
          kind: "external",
        });
      }

      return sources;
    }),
  );

  return sourcesByNamespace.flat();
}

/**
 * Assert that TailorDB table names are unique across all supplied sources.
 * @param args - Validation inputs
 */
function assertUniqueTailorDBTypeNames(args: AssertUniqueTailorDBTypeNamesArgs): void {
  assertUniqueDefinitionNames({
    kind: "tailordb-type",
    uniqueAcross: "all TailorDB namespaces in the application",
    definitions: args.sources.map((source) => {
      const namespaceLabel =
        source.kind === "external"
          ? `external namespace "${source.namespace}"`
          : `namespace "${source.namespace}"`;
      const { file, exportName, source: generatedBy } = source.definition ?? {};
      return {
        name: source.tableName,
        file,
        exportName,
        source: generatedBy ? `${namespaceLabel}, ${generatedBy}` : namespaceLabel,
      };
    }),
  });
}

/**
 * Assert local TailorDB table names are unique.
 * @param args - Validation inputs
 */
export function assertUniqueLocalTailorDBTypeNames(
  args: CollectLocalTailorDBTypeNameSourcesArgs,
): void {
  assertUniqueTailorDBTypeNames({
    sources: collectLocalTailorDBTypeNameSources(args),
  });
}

/**
 * Assert TailorDB table names are unique across local and external namespaces.
 * @param args - Validation inputs
 */
export async function assertUniqueTailorDBTypeNamesWithExternal(
  args: AssertUniqueTailorDBTypeNamesWithExternalArgs,
): Promise<void> {
  const localSources = collectLocalTailorDBTypeNameSources(args);
  const plannedExternalServices = args.plannedExternalTailorDBServices ?? [];
  const plannedExternalNamespaces = new Set(
    plannedExternalServices.map((service) => service.namespace),
  );
  const plannedExternalSources = collectLocalTailorDBTypeNameSources({
    tailorDBServices: plannedExternalServices,
  }).map((source) => ({
    ...source,
    kind: "external" as const,
  }));
  const remoteExternalNamespaces = args.externalTailorDBNamespaces.filter(
    (namespace) => !plannedExternalNamespaces.has(namespace),
  );
  const externalSources =
    remoteExternalNamespaces.length > 0
      ? await fetchExternalTailorDBTypeNameSources({
          client: args.client,
          workspaceId: args.workspaceId,
          externalTailorDBNamespaces: remoteExternalNamespaces,
        })
      : [];

  assertUniqueTailorDBTypeNames({
    sources: [...localSources, ...plannedExternalSources, ...externalSources],
  });
}
