import { fetchAll, isNotFoundError } from "#/cli/shared/client";
import { isPluginGeneratedTable } from "#/parser/service/tailordb/type-source";
import type { TypeSourceInfo, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";

export type LocalTailorDBService = {
  readonly namespace: string;
  readonly types: Readonly<Record<string, unknown>>;
  readonly typeSourceInfo: Readonly<TypeSourceInfo>;
};

type TailorDBTypeNameSourceKind = "local" | "external";

export type TailorDBTypeNameSource = {
  readonly namespace: string;
  readonly tableName: string;
  readonly kind: TailorDBTypeNameSourceKind;
  readonly detail?: string;
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

export interface AssertUniqueTailorDBTypeNamesArgs {
  /** Table-name sources to validate. */
  sources: ReadonlyArray<TailorDBTypeNameSource>;
}

export interface AssertUniqueTailorDBTypeNamesWithExternalArgs
  extends CollectLocalTailorDBTypeNameSourcesArgs, FetchExternalTailorDBTypeNameSourcesArgs {
  /** External TailorDB services planned in the same deploy run. */
  plannedExternalTailorDBServices?: ReadonlyArray<LocalTailorDBService>;
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
export function collectLocalTailorDBTypeNameSources(
  args: CollectLocalTailorDBTypeNameSourcesArgs,
): TailorDBTypeNameSource[] {
  const sources: TailorDBTypeNameSource[] = [];

  for (const service of args.tailorDBServices) {
    for (const tableName of Object.keys(service.types)) {
      sources.push({
        namespace: service.namespace,
        tableName,
        kind: "local",
        detail: formatTailorDBTypeSourceInfo(service.typeSourceInfo[tableName]),
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
export function assertUniqueTailorDBTypeNames(args: AssertUniqueTailorDBTypeNamesArgs): void {
  const sourcesByTableName = new Map<string, TailorDBTypeNameSource[]>();

  for (const source of args.sources) {
    const existing = sourcesByTableName.get(source.tableName);
    if (existing) {
      existing.push(source);
    } else {
      sourcesByTableName.set(source.tableName, [source]);
    }
  }

  const errors: string[] = [];
  for (const [tableName, sources] of sourcesByTableName) {
    if (sources.length <= 1) {
      continue;
    }

    const sourceList = sources.map(formatTailorDBTypeNameSource).join(", ");
    errors.push(`Table "${tableName}" is defined more than once: ${sourceList}`);
  }

  if (errors.length > 0) {
    throw new Error(
      "Duplicate TailorDB table names detected.\n" +
        `${errors.map((error) => `  - ${error}`).join("\n")}\n` +
        "TailorDB table names must be unique across all TailorDB namespaces in an application.",
    );
  }
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

function formatTailorDBTypeNameSource(source: TailorDBTypeNameSource): string {
  const namespaceLabel =
    source.kind === "external"
      ? `external namespace "${source.namespace}"`
      : `namespace "${source.namespace}"`;

  return source.detail ? `${namespaceLabel} (${source.detail})` : namespaceLabel;
}
