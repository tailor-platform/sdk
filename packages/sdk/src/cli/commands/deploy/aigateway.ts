import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateAIGatewayRequestSchema,
  type DeleteAIGatewayRequestSchema,
  UpdateAIGatewayRequestSchema,
} from "@tailor-platform/tailor-proto/aigateway_pb";
import { resolveStaticWebsiteUrls, type OperatorClient } from "#/cli/shared/client";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import { defineRequestComparison, isRequestUnchanged } from "./compare";
import { diffKeyed, labeledResourceChecks } from "./keyed-diff";
import {
  buildMetaRequest,
  type MetadataLabelWrite,
  resourceTrn,
  writeLabelRefreshes,
  writeMetadataLabels,
} from "./label";
import { createOwnershipTracker, fetchExistingResourcesWithLabels } from "./owned-resource";
import { expectedLocalStaticWebsiteNames } from "./staticwebsite";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";

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
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        update.request.cors = await resolveStaticWebsiteUrls(
          client,
          assertDefined(update.request.workspaceId, "request missing workspaceId"),
          update.request.cors,
          "AIGateway CORS",
        );
        await client.updateAIGateway(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
      ...writeLabelRefreshes(client, changeSet.unchanged),
    ]);
  } else {
    await Promise.all(changeSet.deletes.map((del) => client.deleteAIGateway(del.request)));
  }
}

type CreateAIGateway = {
  name: string;
  request: MessageInitShape<typeof CreateAIGatewayRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateAIGateway = {
  name: string;
  request: MessageInitShape<typeof UpdateAIGatewayRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteAIGateway = {
  name: string;
  request: MessageInitShape<typeof DeleteAIGatewayRequestSchema>;
};

type DesiredAIGateway = {
  name: string;
  request: MessageInitShape<typeof CreateAIGatewayRequestSchema> &
    MessageInitShape<typeof UpdateAIGatewayRequestSchema>;
  /** The request with its `:url` CORS entries resolved as the plan resolves them. */
  comparableRequest: MessageInitShape<typeof UpdateAIGatewayRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

const aiGatewayComparison = defineRequestComparison({
  schema: UpdateAIGatewayRequestSchema,
  // The platform keeps `disabled` when the update carries no mask, so deploy leaves it alone.
  excluded: ["workspaceId", "aigatewayName", "updateMask", "disabled"],
  normalize: (request) => {
    request.cors.sort();
  },
});

/**
 * Plan AI Gateway changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planAIGateway(context: PlanContext) {
  const { client, workspaceId, application, owner, forRemoval } = context;
  const changeSet = createChangeSet<CreateAIGateway, UpdateAIGateway, DeleteAIGateway>(
    "AIGateways",
  );
  const ownership = createOwnershipTracker(owner);

  const existingGateways = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, pageSize) => {
      const { aigateways, nextPageToken } = await client.listAIGateways({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [aigateways, nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (name) => resourceTrn(workspaceId, "aigateway", name),
  });

  const aiGatewayServices = forRemoval ? [] : application.aiGatewayServices;
  const expectedLocalWebsites = expectedLocalStaticWebsiteNames(context);
  const desired: DesiredAIGateway[] = [];
  for (const config of aiGatewayServices) {
    const name = config.name;
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "aigateway", name),
      owner,
    });
    const resolvedCors = await resolveStaticWebsiteUrls(
      client,
      workspaceId,
      config.cors ? [...config.cors] : [],
      "AIGateway CORS",
      { expectedLocalNames: expectedLocalWebsites },
    );
    const request = {
      workspaceId,
      aigatewayName: name,
      authNamespace: config.authNamespace,
      cors: config.cors ? [...config.cors] : [],
    };
    desired.push({
      name,
      request,
      comparableRequest: { ...request, cors: resolvedCors },
      metaRequest,
    });
  }

  await diffKeyed({
    changeSet,
    desired,
    existing: Object.entries(existingGateways),
    keyOf: (gateway) => gateway.name,
    ...labeledResourceChecks(ownership, "aigateway"),
    isConfigUnchanged: (gateway, existing) =>
      isRequestUnchanged(aiGatewayComparison, gateway.comparableRequest, existing.resource),
    create: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    update: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
    unchanged: ({ name }) => ({ name }),
    delete: (name) => ({ name, request: { workspaceId, aigatewayName: name } }),
  });

  return { changeSet, ...ownership.result, existingGateways };
}
