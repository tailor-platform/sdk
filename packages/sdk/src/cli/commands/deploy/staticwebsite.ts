import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateStaticWebsiteRequestSchema,
  type DeleteStaticWebsiteRequestSchema,
  type UpdateStaticWebsiteRequestSchema,
} from "@tailor-proto/tailor/v1/staticwebsite_pb";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import {
  buildMetaRequest,
  hasMatchingSdkVersion,
  isOwnedByApp,
  sdkNameLabelKey,
  type WithLabel,
} from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/deploy/deploy";
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

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:staticwebsite:${name}`;
}

function normalizeComparableStaticWebsiteShape(
  input: Pick<ComparableStaticWebsite, "description" | "allowedIpAddresses">,
): ComparableStaticWebsite {
  return {
    description: input.description,
    allowedIpAddresses: [...input.allowedIpAddresses].sort(),
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

  // Fetch existing static websites
  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { staticwebsites, nextPageToken } = await client.listStaticWebsites({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [staticwebsites, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingWebsites: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.name),
      });
      existingWebsites[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  const staticWebsiteServices = forRemoval ? [] : application.staticWebsiteServices;
  for (const websiteService of staticWebsiteServices) {
    const config = websiteService;
    const name = websiteService.name;
    const existing = existingWebsites[name];
    const metaRequest = await buildMetaRequest({
      trn: trn(workspaceId, name),
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
      const owned = isOwnedByApp(existing.allLabels, application.name, application.id);
      if (!owned) {
        if (!existing.label) {
          unmanaged.push({
            resourceType: "StaticWebsite",
            resourceName: name,
          });
        } else {
          conflicts.push({
            resourceType: "StaticWebsite",
            resourceName: name,
            currentOwner: existing.label,
          });
        }
      }

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
    const owned = isOwnedByApp(entry?.allLabels, application.name, application.id);
    if (label && !owned) {
      resourceOwners.add(label);
    }
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
