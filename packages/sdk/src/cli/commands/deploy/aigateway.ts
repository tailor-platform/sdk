import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateAIGatewayRequestSchema,
  type DeleteAIGatewayRequestSchema,
  type UpdateAIGatewayRequestSchema,
} from "@tailor-platform/tailor-proto/aigateway_pb";
import { resolveStaticWebsiteUrls, type OperatorClient } from "#/cli/shared/client";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { AIGateway as ProtoAIGateway } from "@tailor-platform/tailor-proto/aigateway_resource_pb";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";

/**
 * Apply AI Gateway changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned AI Gateway changes
 * @param phase - Apply phase
 * @returns Promise that resolves when AI Gateways are applied
 */
export async function applyAIGateway(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planAIGateway>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        create.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(create.request.workspaceId, "request missing workspaceId"),
          create.request.cors,
          "AIGateway CORS",
        );
        await client.createAIGateway(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        update.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(update.request.workspaceId, "request missing workspaceId"),
          update.request.cors,
          "AIGateway CORS",
        );
        await client.updateAIGateway(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else {
    await Promise.all(changeSet.deletes.map((del) => client.deleteAIGateway(del.request)));
  }
}

type CreateAIGateway = {
  name: string;
  request: MessageInitShape<typeof CreateAIGatewayRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateAIGateway = {
  name: string;
  request: MessageInitShape<typeof UpdateAIGatewayRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteAIGateway = {
  name: string;
  request: MessageInitShape<typeof DeleteAIGatewayRequestSchema>;
};

type ComparableAIGateway = {
  authNamespace: string;
  cors: string[];
};

type ComparableAIGatewayInput = {
  authNamespace?: string;
  cors?: readonly string[];
};

function normalizeComparableAIGatewayShape(
  input: Pick<ComparableAIGateway, "authNamespace" | "cors">,
): ComparableAIGateway {
  return {
    authNamespace: input.authNamespace,
    cors: input.cors.toSorted(),
  };
}

function normalizeComparableAIGateway(input: ComparableAIGatewayInput): ComparableAIGateway {
  return normalizeComparableAIGatewayShape({
    authNamespace: input.authNamespace || "",
    cors: [...(input.cors || [])],
  });
}

function areAIGatewaysEqual(existing: ProtoAIGateway, desired: ComparableAIGatewayInput): boolean {
  return areNormalizedEqual(
    normalizeComparableAIGateway(existing),
    normalizeComparableAIGateway(desired),
  );
}

/**
 * Plan AI Gateway changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planAIGateway(context: PlanContext) {
  const { client, workspaceId, application, forRemoval } = context;
  const changeSet = createChangeSet<CreateAIGateway, UpdateAIGateway, DeleteAIGateway>(
    "AIGateways",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const existingGateways = await fetchExistingResourcesWithLabels({
    client,
    workspaceId,
    fetchPage: async (pageToken, pageSize) => {
      const { aigateways, nextPageToken } = await client.listAIGateways({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [aigateways, nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (workspaceId, name) => resourceTrn(workspaceId, "aigateway", name),
  });

  const aiGatewayServices = forRemoval ? [] : application.aiGatewayServices;
  const expectedLocalWebsites =
    context.expectedLocalStaticWebsiteNames ??
    new Set(application.staticWebsiteServices.map((website) => website.name));
  for (const gatewayService of aiGatewayServices) {
    const config = gatewayService;
    const name = gatewayService.name;
    const existing = existingGateways[name];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "aigateway", name),
      appName: application.name,
      appId: application.id,
    });
    const resolvedCors = await resolveStaticWebsiteUrls(
      client,
      workspaceId,
      config.cors ? [...config.cors] : [],
      "AIGateway CORS",
      { expectedLocalNames: expectedLocalWebsites },
    );
    const desired = normalizeComparableAIGateway({ ...config, cors: resolvedCors });
    const request = {
      workspaceId,
      aigatewayName: name,
      authNamespace: config.authNamespace,
      cors: config.cors ? [...config.cors] : [],
    };

    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName: application.name,
        appId: application.id,
        resourceType: "AIGateway",
        resourceName: name,
        conflicts,
        unmanaged,
      });

      if (
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        areAIGatewaysEqual(existing.resource as ProtoAIGateway, desired)
      ) {
        changeSet.unchanged.push({ name });
      } else {
        changeSet.updates.push({
          name,
          request,
          metaRequest,
        });
      }
      delete existingGateways[name];
    } else {
      changeSet.creates.push({
        name,
        request,
        metaRequest,
      });
    }
  }
  Object.entries(existingGateways).forEach(([name, entry]) => {
    const label = entry?.label;
    const owned = trackRemainingResourceOwner({
      labels: entry?.allLabels,
      ownerLabel: label,
      appName: application.name,
      appId: application.id,
      resourceOwners,
    });
    if (owned) {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          aigatewayName: name,
        },
      });
    }
  });

  return { changeSet, conflicts, unmanaged, resourceOwners };
}
