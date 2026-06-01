import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type Application as ProtoApplication,
  Subgraph_ServiceType,
  type SubgraphSchema,
} from "@tailor-proto/tailor/v1/application_resource_pb";
import { fetchAll, resolveStaticWebsiteUrls, type OperatorClient } from "@/cli/shared/client";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, isOwnedByApp } from "./label";
import type { ApplyPhase, PlanContext } from "@/cli/commands/deploy/deploy";
import type { Application } from "@/cli/services/application";
import type {
  DeleteApplicationRequestSchema,
  CreateApplicationRequestSchema,
  UpdateApplicationRequestSchema,
} from "@tailor-proto/tailor/v1/application_pb";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

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
          create.request.workspaceId!,
          create.request.cors,
          "CORS",
        );
        await client.createApplication(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...updates.map(async (update) => {
        update.request.cors = await resolveStaticWebsiteUrls(
          client,
          update.request.workspaceId!,
          update.request.cors,
          "CORS",
        );
        await client.updateApplication(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
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
};

type UpdateApplication = {
  name: string;
  request: MessageInitShape<typeof UpdateApplicationRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteApplication = {
  name: string;
  request: MessageInitShape<typeof DeleteApplicationRequestSchema>;
};

type ComparableApplication = {
  authNamespace: string;
  authIdpConfigName: string;
  cors: string[];
  subgraphs: Array<{ serviceType: Subgraph_ServiceType; serviceNamespace: string }>;
  allowedIpAddresses: string[];
  disableIntrospection: boolean;
  disabled: boolean;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:application:${name}`;
}

function sortStrings(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

function normalizeSubgraphs(
  subgraphs: ReadonlyArray<MessageInitShape<typeof SubgraphSchema>> | undefined,
): ComparableApplication["subgraphs"] {
  return [...(subgraphs ?? [])]
    .map((subgraph) => ({
      serviceType: subgraph.serviceType!,
      serviceNamespace: subgraph.serviceNamespace ?? "",
    }))
    .sort((left, right) => {
      if (left.serviceType !== right.serviceType) {
        return left.serviceType - right.serviceType;
      }
      return left.serviceNamespace.localeCompare(right.serviceNamespace);
    });
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
  };
}

function normalizeComparableApplication(
  application: Readonly<Application>,
  authNamespace: string | undefined,
  authIdpConfigName: string | undefined,
  cors: string[],
): ComparableApplication {
  return toComparableApplication({
    authNamespace: authNamespace ?? "",
    authIdpConfigName: authIdpConfigName ?? "",
    cors,
    subgraphs: normalizeSubgraphs(application.subgraphs.map((subgraph) => protoSubgraph(subgraph))),
    allowedIpAddresses: application.config.allowedIpAddresses ?? [],
    disableIntrospection: application.config.disableIntrospection ?? false,
    disabled: false,
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
  });
}

function areApplicationsEqual(existing: ProtoApplication, desired: ComparableApplication): boolean {
  return areNormalizedEqual(normalizeComparableExistingApplication(existing), desired);
}

/**
 * Plan application changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planApplication(context: PlanContext) {
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
    // Only delete apps we can prove we own. Ownership is decided by label
    // match (sdk-app-id when an id is configured, sdk-name otherwise) via
    // isOwnedByApp — the same check every other resource type uses.
    // Matching by name alone is unsafe: in a shared workspace a different
    // user's app may carry the same name, and removing it by name would
    // delete a resource we don't manage.
    const owned = await Promise.all(
      existingApplications.map(async (app) => {
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
  if (application.authService && application.authService.config) {
    authNamespace = application.authService.config.name;

    const idProvider = application.authService.config.idProvider;
    if (idProvider) {
      authIdpConfigName = idProvider.name;
    }
  } else if (application.config.auth) {
    // Retrieve idpConfig from remote when auth references an external namespace
    authNamespace = application.config.auth.name;
    const idpConfigs = await fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { idpConfigs, nextPageToken } = await client.listAuthIDPConfigs({
          workspaceId,
          namespaceName: authNamespace!,
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
      authIdpConfigName = idpConfigs[0].name;
    }
  }
  const metaRequest = await buildMetaRequest({
    trn: trn(workspaceId, application.name),
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
  const desired = normalizeComparableApplication(
    application,
    authNamespace,
    authIdpConfigName,
    resolvedCors,
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
      changeSet.updates.push(update);
    }
  } else {
    changeSet.creates.push({
      name: application.name,
      request,
      metaRequest,
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
      trn: trn(workspaceId, appName),
    });
    return metadata?.labels;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined;
    }
    throw error;
  }
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
