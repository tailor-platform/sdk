import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type Application as ProtoApplication,
  Subgraph_ServiceType,
  type SubgraphSchema,
} from "@tailor-platform/tailor-proto/application_resource_pb";
import { fetchAll, resolveStaticWebsiteUrls, type OperatorClient } from "#/cli/shared/client";
import { symbols } from "#/cli/shared/logger";
import { HTTP_METHODS } from "#/parser/service/http-adapter/index";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, isOwnedByApp, resourceTrn } from "./label";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { Application } from "#/cli/services/application";
import type { HttpAdapterBundleResult } from "#/cli/services/http-adapter/bundler";
import type {
  DeleteApplicationRequestSchema,
  CreateApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-platform/tailor-proto/application_pb";
import type { HttpAdapterSchema } from "@tailor-platform/tailor-proto/http_adapter_resource_pb";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";

/**
 * Apply application changes for the given phase.
 * @param client - Operator client instance
 * @param changeSet - Planned application changes
 * @param phase - Apply phase
 * @returns Promise that resolves when applications are applied
 */
export async function applyApplication(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planApplication>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  if (phase === "create-update") {
    // Re-issue updateApplication for unchanged apps too, so the platform
    // re-composes the gateway schema synchronously on every deploy.
    const updates = [...changeSet.updates, ...changeSet.unchanged];
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        create.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(create.request.workspaceId, "request missing workspaceId"),
          create.request.cors,
          "CORS",
        );
        await client.createApplication(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...updates.map(async (update) => {
        update.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(update.request.workspaceId, "request missing workspaceId"),
          update.request.cors,
          "CORS",
        );
        await client.updateApplication(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else {
    // Delete in reverse order of dependencies
    // Applications
    await Promise.all(
      changeSet.deletes.map(async (del) => {
        await client.deleteApplication(del.request);
      }),
    );
  }
}

type CreateApplication = {
  name: string;
  request: MessageInitShape<typeof CreateApplicationRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
  /** Per-adapter diff lines shown indented beneath the application entry. */
  details?: string[];
};

type UpdateApplication = {
  name: string;
  request: MessageInitShape<typeof UpdateApplicationRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
  /** Per-adapter diff lines shown indented beneath the application entry. */
  details?: string[];
};

type DeleteApplication = {
  name: string;
  request: MessageInitShape<typeof DeleteApplicationRequestSchema>;
};

type ComparableHttpAdapter = {
  name: string;
  pathPattern: string;
  methods: string[];
  inputScript: string;
  outputScript: string;
  enabled: boolean;
  priority: number;
};

type ComparableApplication = {
  authNamespace: string;
  authIdpConfigName: string;
  cors: string[];
  subgraphs: Array<{
    serviceType: Subgraph_ServiceType;
    serviceNamespace: string;
  }>;
  allowedIpAddresses: string[];
  disableIntrospection: boolean;
  disabled: boolean;
  httpAdapters: ComparableHttpAdapter[];
};

function sortStrings(values: readonly string[] | undefined): string[] {
  return (values ?? []).toSorted();
}

function normalizeSubgraphs(
  subgraphs: ReadonlyArray<MessageInitShape<typeof SubgraphSchema>> | undefined,
): ComparableApplication["subgraphs"] {
  return [...(subgraphs ?? [])]
    .map((subgraph) => ({
      serviceType: assertDefined(subgraph.serviceType, "subgraph missing serviceType"),
      serviceNamespace: subgraph.serviceNamespace ?? "",
    }))
    .toSorted((left, right) => {
      if (left.serviceType !== right.serviceType) {
        return left.serviceType - right.serviceType;
      }
      return left.serviceNamespace.localeCompare(right.serviceNamespace);
    });
}

function normalizeHttpAdapters(
  httpAdapters:
    | ReadonlyArray<{
        name?: string;
        pathPattern?: string;
        methods?: string[];
        inputScript?: string;
        outputScript?: string;
        enabled?: boolean;
        priority?: number;
      }>
    | undefined,
): ComparableHttpAdapter[] {
  return [...(httpAdapters ?? [])]
    .map((adapter) => ({
      name: adapter.name ?? "",
      pathPattern: adapter.pathPattern ?? "",
      methods: sortStrings(adapter.methods),
      inputScript: adapter.inputScript ?? "",
      outputScript: adapter.outputScript ?? "",
      // Fallbacks mirror the schema defaults; in practice both sides always
      // carry explicit values (the SDK sets them and proto bools are present).
      enabled: adapter.enabled ?? true,
      priority: adapter.priority ?? 0,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function toComparableApplication(
  input: Pick<
    ComparableApplication,
    | "authNamespace"
    | "authIdpConfigName"
    | "cors"
    | "subgraphs"
    | "allowedIpAddresses"
    | "disableIntrospection"
    | "disabled"
    | "httpAdapters"
  >,
): ComparableApplication {
  return {
    authNamespace: input.authNamespace,
    authIdpConfigName: input.authIdpConfigName,
    cors: sortStrings(input.cors),
    subgraphs: [...input.subgraphs],
    allowedIpAddresses: sortStrings(input.allowedIpAddresses),
    disableIntrospection: input.disableIntrospection,
    disabled: input.disabled,
    httpAdapters: [...input.httpAdapters],
  };
}

function normalizeComparableApplication(
  application: Readonly<Application>,
  authNamespace: string | undefined,
  authIdpConfigName: string | undefined,
  cors: string[],
  httpAdapters: ReadonlyArray<MessageInitShape<typeof HttpAdapterSchema>>,
): ComparableApplication {
  return toComparableApplication({
    authNamespace: authNamespace ?? "",
    authIdpConfigName: authIdpConfigName ?? "",
    cors,
    subgraphs: normalizeSubgraphs(application.subgraphs.map((subgraph) => protoSubgraph(subgraph))),
    allowedIpAddresses: application.config.allowedIpAddresses ?? [],
    disableIntrospection: application.config.disableIntrospection ?? false,
    disabled: false,
    httpAdapters: normalizeHttpAdapters(httpAdapters),
  });
}

function normalizeComparableExistingApplication(app: ProtoApplication): ComparableApplication {
  return toComparableApplication({
    authNamespace: app.authNamespace,
    authIdpConfigName: app.authIdpConfigName,
    cors: app.cors,
    subgraphs: normalizeSubgraphs(app.subgraphs),
    allowedIpAddresses: app.allowedIpAddresses,
    disableIntrospection: app.disableIntrospection,
    disabled: app.disabled,
    httpAdapters: normalizeHttpAdapters(app.httpAdapters),
  });
}

function areApplicationsEqual(existing: ProtoApplication, desired: ComparableApplication): boolean {
  return areNormalizedEqual(normalizeComparableExistingApplication(existing), desired);
}

/**
 * Plan application changes based on current and desired state.
 * @param context - Planning context
 * @param httpAdapterBuildResult - Bundled HTTP adapter scripts to embed on the Application
 * @returns Planned changes
 */
export async function planApplication(
  context: PlanContext,
  httpAdapterBuildResult?: HttpAdapterBundleResult,
) {
  const { client, workspaceId, application, forRemoval } = context;
  const changeSet = createChangeSet<
    CreateApplication,
    UpdateApplication,
    DeleteApplication,
    never,
    UpdateApplication
  >("Applications");

  const existingApplications = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { applications, nextPageToken } = await client.listApplications({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [applications, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  if (forRemoval) {
    // A same-named app in a shared workspace may belong to another user, so
    // never delete by name alone. Without an id only the same-name app can be
    // ours; with an id, scan all apps to also clean up renamed-away ones.
    const candidates = application.id
      ? existingApplications
      : existingApplications.filter((app) => app.name === application.name);
    const owned = await Promise.all(
      candidates.map(async (app) => {
        const labels = await fetchAppLabels(client, workspaceId, app.name);
        return isOwnedByApp(labels, application.name, application.id) ? app.name : null;
      }),
    );
    for (const name of owned) {
      if (name) {
        changeSet.deletes.push({
          name,
          request: {
            workspaceId,
            applicationName: name,
          },
        });
      }
    }
    return changeSet;
  }

  // Skip application create/update when there are no subgraphs
  // (e.g. deploying only static web hosting)
  if (application.subgraphs.length === 0) {
    return changeSet;
  }

  let authNamespace: string | undefined;
  let authIdpConfigName: string | undefined;
  if (application.authService) {
    authNamespace = application.authService.config.name;

    const idProvider = application.authService.config.idProvider;
    if (idProvider) {
      authIdpConfigName = idProvider.name;
    }
  } else if (application.config.auth) {
    // Prefer peer plans for same-run multi-config deploys; otherwise read remote state.
    authNamespace = application.config.auth.name;
    authIdpConfigName = context.externalAuthIdpConfigNames?.get(authNamespace);
    if (!authIdpConfigName) {
      const idpConfigs = await fetchAll(async (pageToken, maxPageSize) => {
        try {
          const { idpConfigs, nextPageToken } = await client.listAuthIDPConfigs({
            workspaceId,
            namespaceName: assertDefined(
              authNamespace,
              "authNamespace must be set before listing IDP configs",
            ),
            pageToken,
            pageSize: maxPageSize,
          });
          return [idpConfigs, nextPageToken];
        } catch (error) {
          if (error instanceof ConnectError && error.code === Code.NotFound) {
            return [[], ""];
          }
          throw error;
        }
      });
      if (idpConfigs.length > 0) {
        const [firstConfig] = idpConfigs;
        if (firstConfig) {
          authIdpConfigName = firstConfig.name;
        }
      }
    }
  }
  const metaRequest = await buildMetaRequest({
    trn: resourceTrn(workspaceId, "application", application.name),
    appName: application.name,
    appId: application.id,
  });
  const expectedLocalWebsites = new Set(
    application.staticWebsiteServices.map((website) => website.name),
  );
  const resolvedCors = await resolveStaticWebsiteUrls(
    client,
    workspaceId,
    application.config.cors,
    "CORS",
    { expectedLocalNames: expectedLocalWebsites },
  );
  const httpAdapters = buildHttpAdapters(application, httpAdapterBuildResult);
  const desired = normalizeComparableApplication(
    application,
    authNamespace,
    authIdpConfigName,
    resolvedCors,
    httpAdapters,
  );
  const request = {
    workspaceId,
    applicationName: application.name,
    authNamespace,
    authIdpConfigName,
    cors: application.config.cors,
    subgraphs: application.subgraphs.map((subgraph) => protoSubgraph(subgraph)),
    allowedIpAddresses: application.config.allowedIpAddresses,
    disableIntrospection: application.config.disableIntrospection,
    httpAdapters,
  };
  const existing = existingApplications.find((app) => app.name === application.name);

  // Detect renames: other apps owned by our id should be deleted before
  // creating/updating the current name (so the old name is freed up).
  if (application.id) {
    const otherApps = existingApplications.filter((app) => app.name !== application.name);
    const renamedAway = await Promise.all(
      otherApps.map(async (app) => {
        const labels = await fetchAppLabels(client, workspaceId, app.name);
        return isOwnedByApp(labels, application.name, application.id) ? app.name : null;
      }),
    );
    for (const name of renamedAway) {
      if (name) {
        changeSet.deletes.push({
          name,
          request: {
            workspaceId,
            applicationName: name,
          },
        });
      }
    }
  }

  if (existing) {
    const labels = await fetchAppLabels(client, workspaceId, application.name);
    const update: UpdateApplication = {
      name: application.name,
      request,
      metaRequest,
    };
    if (
      isOwnedByApp(labels, application.name, application.id) &&
      hasMatchingSdkVersion(labels, metaRequest.labels) &&
      areApplicationsEqual(existing, desired)
    ) {
      // Plan display shows this as unchanged, but apply still re-issues it.
      changeSet.unchanged.push(update);
    } else {
      const details = diffHttpAdapterDisplay(existing.httpAdapters, httpAdapters);
      if (details.length > 0) {
        update.details = details;
      }
      changeSet.updates.push(update);
    }
  } else {
    const details = diffHttpAdapterDisplay(undefined, httpAdapters);
    changeSet.creates.push({
      name: application.name,
      request,
      metaRequest,
      details: details.length > 0 ? details : undefined,
    });
  }

  return changeSet;
}

async function fetchAppLabels(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
): Promise<Record<string, string> | undefined> {
  try {
    const { metadata } = await client.getMetadata({
      trn: resourceTrn(workspaceId, "application", appName),
    });
    return metadata?.labels;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Build per-adapter diff lines for the application plan display. The platform
 * models HTTP adapters as an embedded Application field (no dedicated RPC), so
 * adapter changes surface as an Application update; these lines show which
 * adapter actually changed instead of just `~ <app>`.
 * @param existingAdapters - HTTP adapters currently deployed on the application
 * @param desiredAdapters - HTTP adapters built from the local config
 * @returns Indented diff lines (`+`/`~`/`-` per adapter), sorted by name
 */
export function diffHttpAdapterDisplay(
  existingAdapters: ReadonlyArray<MessageInitShape<typeof HttpAdapterSchema>> | undefined,
  desiredAdapters: ReadonlyArray<MessageInitShape<typeof HttpAdapterSchema>>,
): string[] {
  const existingByName = new Map((existingAdapters ?? []).map((a) => [a.name ?? "", a]));
  const desiredByName = new Map(desiredAdapters.map((a) => [a.name ?? "", a]));
  const entries: Array<{ name: string; symbol: string }> = [];
  for (const [name, desired] of desiredByName) {
    const existing = existingByName.get(name);
    if (!existing) {
      entries.push({ name, symbol: symbols.create });
    } else if (
      !areNormalizedEqual(normalizeHttpAdapters([existing])[0], normalizeHttpAdapters([desired])[0])
    ) {
      entries.push({ name, symbol: symbols.update });
    }
  }
  for (const name of existingByName.keys()) {
    if (!desiredByName.has(name)) {
      entries.push({ name, symbol: symbols.delete });
    }
  }
  return entries
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.symbol} ${entry.name} (httpAdapter)`);
}

function buildHttpAdapters(
  application: Readonly<Application>,
  httpAdapterBuildResult: HttpAdapterBundleResult | undefined,
): MessageInitShape<typeof HttpAdapterSchema>[] {
  const adapters = application.httpAdapterService?.adapters ?? [];
  if (adapters.length === 0) {
    return [];
  }
  return adapters.map((loaded) => {
    const inputScript = httpAdapterBuildResult?.bundledInputs.get(loaded.adapter.name);
    if (!inputScript) {
      throw new Error(
        `HTTP adapter "${loaded.adapter.name}" was loaded but no bundled input script is available`,
      );
    }
    let outputScript = "";
    if (loaded.hasOutput) {
      const bundled = httpAdapterBuildResult?.bundledOutputs.get(loaded.adapter.name);
      if (!bundled) {
        throw new Error(
          `HTTP adapter "${loaded.adapter.name}" declares an output handler but no bundled output script is available`,
        );
      }
      outputScript = bundled;
    }
    return {
      name: loaded.adapter.name,
      pathPattern: loaded.adapter.pathPattern,
      methods: loaded.methods.map((m) => HTTP_METHODS[m]),
      inputScript,
      outputScript,
      // `enabled`/`priority` are always populated here because
      // HttpAdapterConfigSchema applies their defaults during parse.
      enabled: loaded.adapter.enabled,
      priority: loaded.adapter.priority,
    };
  });
}

function protoSubgraph(
  subgraph: Readonly<{ Type: string; Name: string }>,
): MessageInitShape<typeof SubgraphSchema> {
  // TODO(remiposo): Make it type-safe
  let serviceType: Subgraph_ServiceType;
  switch (subgraph.Type) {
    case "tailordb":
      serviceType = Subgraph_ServiceType.TAILORDB;
      break;
    case "pipeline":
      serviceType = Subgraph_ServiceType.PIPELINE;
      break;
    case "idp":
      serviceType = Subgraph_ServiceType.IDP;
      break;
    case "auth":
      serviceType = Subgraph_ServiceType.AUTH;
      break;
    default:
      throw new Error(`Unknown subgraph type: ${subgraph.Type}`);
  }
  return {
    serviceType,
    serviceNamespace: subgraph.Name,
  };
}
