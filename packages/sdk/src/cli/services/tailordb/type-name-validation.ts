import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll } from "@/cli/shared/client";
import { isPluginGeneratedType } from "@/types/tailordb";
import type { TypeSourceInfo, TypeSourceInfoEntry } from "@/types/tailordb";

type LocalTailorDBService = {
  readonly namespace: string;
  readonly types: Readonly<Record<string, unknown>>;
  readonly typeSourceInfo: Readonly<TypeSourceInfo>;
};

type TailorDBTypeNameSourceKind = "local" | "external";

export type TailorDBTypeNameSource = {
  readonly namespace: string;
  readonly typeName: string;
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
  /** Type-name sources to validate. */
  sources: ReadonlyArray<TailorDBTypeNameSource>;
}

export interface AssertUniqueTailorDBTypeNamesWithExternalArgs
  extends CollectLocalTailorDBTypeNameSourcesArgs, FetchExternalTailorDBTypeNameSourcesArgs {}

/**
 * Format a TailorDB type source for validation errors.
 * @param sourceInfo - Source information captured when loading the type
 * @returns Human-readable source detail
 */
export function formatTailorDBTypeSourceInfo(
  sourceInfo: TypeSourceInfoEntry | undefined,
): string | undefined {
  if (!sourceInfo) {
    return undefined;
  }

  if (isPluginGeneratedType(sourceInfo)) {
    const parts = [`plugin ${sourceInfo.pluginId}`];
    if (sourceInfo.generatedTypeKind) {
      parts.push(`kind ${sourceInfo.generatedTypeKind}`);
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
 * Collect TailorDB type-name sources from loaded local services.
 * @param args - Collection inputs
 * @returns Type-name sources for local services
 */
export function collectLocalTailorDBTypeNameSources(
  args: CollectLocalTailorDBTypeNameSourcesArgs,
): TailorDBTypeNameSource[] {
  const sources: TailorDBTypeNameSource[] = [];

  for (const service of args.tailorDBServices) {
    for (const typeName of Object.keys(service.types)) {
      sources.push({
        namespace: service.namespace,
        typeName,
        kind: "local",
        detail: formatTailorDBTypeSourceInfo(service.typeSourceInfo[typeName]),
      });
    }
  }

  return sources;
}

/**
 * Fetch TailorDB type-name sources for external namespaces.
 * @param args - Fetch inputs
 * @returns Type-name sources for external services
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
          if (error instanceof ConnectError && error.code === Code.NotFound) {
            return [[], ""];
          }
          throw error;
        }
      });

      for (const type of tailordbTypes) {
        sources.push({
          namespace,
          typeName: type.name,
          kind: "external",
        });
      }

      return sources;
    }),
  );

  return sourcesByNamespace.flat();
}

/**
 * Assert that TailorDB type names are unique across all supplied sources.
 * @param args - Validation inputs
 */
export function assertUniqueTailorDBTypeNames(args: AssertUniqueTailorDBTypeNamesArgs): void {
  const sourcesByTypeName = new Map<string, TailorDBTypeNameSource[]>();

  for (const source of args.sources) {
    const existing = sourcesByTypeName.get(source.typeName);
    if (existing) {
      existing.push(source);
    } else {
      sourcesByTypeName.set(source.typeName, [source]);
    }
  }

  const errors: string[] = [];
  for (const [typeName, sources] of sourcesByTypeName) {
    if (sources.length <= 1) {
      continue;
    }

    const sourceList = sources.map(formatTailorDBTypeNameSource).join(", ");
    errors.push(`Type "${typeName}" is defined more than once: ${sourceList}`);
  }

  if (errors.length > 0) {
    throw new Error(
      "Duplicate TailorDB type names detected.\n" +
        `${errors.map((error) => `  - ${error}`).join("\n")}\n` +
        "TailorDB type names must be unique across all TailorDB namespaces in an application.",
    );
  }
}

/**
 * Assert local TailorDB type names are unique.
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
 * Assert TailorDB type names are unique across local and external namespaces.
 * @param args - Validation inputs
 */
export async function assertUniqueTailorDBTypeNamesWithExternal(
  args: AssertUniqueTailorDBTypeNamesWithExternalArgs,
): Promise<void> {
  const localSources = collectLocalTailorDBTypeNameSources(args);
  const externalSources =
    args.externalTailorDBNamespaces.length > 0
      ? await fetchExternalTailorDBTypeNameSources(args)
      : [];

  assertUniqueTailorDBTypeNames({
    sources: [...localSources, ...externalSources],
  });
}

function formatTailorDBTypeNameSource(source: TailorDBTypeNameSource): string {
  const namespaceLabel =
    source.kind === "external"
      ? `external namespace "${source.namespace}"`
      : `namespace "${source.namespace}"`;

  return source.detail ? `${namespaceLabel} (${source.detail})` : namespaceLabel;
}
