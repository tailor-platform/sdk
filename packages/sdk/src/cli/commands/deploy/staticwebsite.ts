import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateStaticWebsiteRequestSchema,
  type DeleteStaticWebsiteRequestSchema,
  type UpdateStaticWebsiteRequestSchema,
} from "@tailor-proto/tailor/v1/staticwebsite_pb";
import { type OperatorClient } from "@/cli/shared/client";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/deploy/types";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";
import type { StaticWebsite as ProtoStaticWebsite } from "@tailor-proto/tailor/v1/staticwebsite_resource_pb";

/**
 * Apply static website changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned static website changes
 * @param phase - Apply phase
 * @returns Promise that resolves when static websites are applied
 */
export async function applyStaticWebsite(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planStaticWebsite>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // StaticWebsites
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await client.createStaticWebsite(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateStaticWebsite(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // StaticWebsites
    await Promise.all(changeSet.deletes.map((del) => client.deleteStaticWebsite(del.request)));
  }
}

type CreateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof CreateStaticWebsiteRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof UpdateStaticWebsiteRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof DeleteStaticWebsiteRequestSchema>;
};

type ComparableStaticWebsite = {
  description: string;
  allowedIpAddresses: string[];
};

type ComparableStaticWebsiteInput = {
  description?: string;
  allowedIpAddresses?: readonly string[];
};

function normalizeComparableStaticWebsiteShape(
  input: Pick<ComparableStaticWebsite, "description" | "allowedIpAddresses">,
): ComparableStaticWebsite {
  return {
    description: input.description,
    allowedIpAddresses: input.allowedIpAddresses.toSorted(),
  };
}

function normalizeComparableStaticWebsite(
  input: ComparableStaticWebsiteInput,
): ComparableStaticWebsite {
  return normalizeComparableStaticWebsiteShape({
    description: input.description || "",
    allowedIpAddresses: [...(input.allowedIpAddresses || [])],
  });
}

function areStaticWebsitesEqual(
  existing: ProtoStaticWebsite,
  desired: ComparableStaticWebsiteInput,
): boolean {
  return areNormalizedEqual(
    normalizeComparableStaticWebsite(existing),
    normalizeComparableStaticWebsite(desired),
  );
}

/**
 * Plan static website changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planStaticWebsite(context: PlanContext) {
  const { client, workspaceId, application, forRemoval } = context;
  const changeSet = createChangeSet<CreateStaticWebsite, UpdateStaticWebsite, DeleteStaticWebsite>(
    "StaticWebsites",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const existingWebsites = await fetchExistingResourcesWithLabels({
    client,
    workspaceId,
    fetchPage: async (pageToken, pageSize) => {
      const { staticwebsites, nextPageToken } = await client.listStaticWebsites({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [staticwebsites, nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (workspaceId, name) => resourceTrn(workspaceId, "staticwebsite", name),
  });

  const staticWebsiteServices = forRemoval ? [] : application.staticWebsiteServices;
  for (const websiteService of staticWebsiteServices) {
    const config = websiteService;
    const name = websiteService.name;
    const existing = existingWebsites[name];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "staticwebsite", name),
      appName: application.name,
      appId: application.id,
    });
    const desired = normalizeComparableStaticWebsite(config);
    const request = {
      workspaceId,
      staticwebsite: {
        name,
        description: config.description || "",
        allowedIpAddresses: config.allowedIpAddresses || [],
      },
    };

    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName: application.name,
        appId: application.id,
        resourceType: "StaticWebsite",
        resourceName: name,
        conflicts,
        unmanaged,
      });

      if (
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        areStaticWebsitesEqual(existing.resource as ProtoStaticWebsite, desired)
      ) {
        changeSet.unchanged.push({ name });
      } else {
        changeSet.updates.push({
          name,
          request,
          metaRequest,
        });
      }
      delete existingWebsites[name];
    } else {
      changeSet.creates.push({
        name,
        request,
        metaRequest,
      });
    }
  }
  Object.entries(existingWebsites).forEach(([name]) => {
    const entry = existingWebsites[name];
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
          name,
        },
      });
    }
  });

  return { changeSet, conflicts, unmanaged, resourceOwners };
}
