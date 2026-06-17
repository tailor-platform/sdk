import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type AddCustomDomainRequestSchema,
  type CreateStaticWebsiteRequestSchema,
  type DeleteStaticWebsiteRequestSchema,
  type RemoveCustomDomainRequestSchema,
  type UpdateStaticWebsiteRequestSchema,
} from "@tailor-proto/tailor/v1/staticwebsite_pb";
import { type OperatorClient } from "#src/cli/shared/client";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, isOwnedByApp, resourceTrn } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ApplyPhase, PlanContext } from "#src/cli/commands/deploy/types";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
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
  const { changeSet, customDomainChangeSet } = result;
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
    // Custom domains
    await Promise.all([
      ...customDomainChangeSet.creates.map(async (add) => {
        await client.addCustomDomain(add.request);
        await client.setMetadata(add.metaRequest);
      }),
      ...customDomainChangeSet.deletes.map((del) => client.removeCustomDomain(del.request)),
    ]);
  } else {
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

type AddCustomDomainEntry = {
  name: string;
  request: MessageInitShape<typeof AddCustomDomainRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type RemoveCustomDomainEntry = {
  name: string;
  request: MessageInitShape<typeof RemoveCustomDomainRequestSchema>;
};

type ComparableStaticWebsite = {
  description: string;
  allowedIpAddresses: string[];
};

type ComparableStaticWebsiteInput = {
  description?: string;
  allowedIpAddresses?: readonly string[];
};

function customDomainTrn(workspaceId: string, websiteName: string, domain: string) {
  return `trn:v1:workspace:${workspaceId}:staticwebsite:${websiteName}:custom_domain:${domain}`;
}

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
  const customDomainChangeSet = createChangeSet<
    AddCustomDomainEntry,
    never,
    RemoveCustomDomainEntry
  >("CustomDomains");
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

  // Track owned website names to plan custom domains afterward
  const ownedWebsiteNames = new Set<string>();

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

      if (owned) {
        ownedWebsiteNames.add(name);
      }
      delete existingWebsites[name];
    } else {
      changeSet.creates.push({
        name,
        request,
        metaRequest,
      });
      // New websites are owned by this app
      ownedWebsiteNames.add(name);
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

  // Plan custom domain changes for owned websites
  const desiredDomainsByWebsite = new Map<string, readonly string[]>();
  for (const service of staticWebsiteServices) {
    if (service.customDomains !== undefined && ownedWebsiteNames.has(service.name)) {
      desiredDomainsByWebsite.set(service.name, service.customDomains);
    }
  }

  // Fetch existing custom domains and their labels for owned websites that already exist
  type ExistingDomainInfo = { domain: string; allLabels: Record<string, string> | undefined };
  const existingDomainsByWebsite = new Map<string, ExistingDomainInfo[]>();
  const websitesToFetchDomains = [...ownedWebsiteNames].filter(
    (name) => !changeSet.creates.some((c) => c.name === name),
  );
  await Promise.all(
    websitesToFetchDomains.map(async (name) => {
      try {
        const { customDomains } = await client.listCustomDomains({
          workspaceId,
          staticWebsiteName: name,
        });
        const domainsWithLabels = await Promise.all(
          customDomains.map(async (d) => {
            const { metadata } = await client.getMetadata({
              trn: customDomainTrn(workspaceId, name, d.domain),
            });
            return {
              domain: d.domain,
              allLabels: metadata?.labels,
            };
          }),
        );
        existingDomainsByWebsite.set(name, domainsWithLabels);
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return;
        }
        throw error;
      }
    }),
  );

  // Diff custom domains for each owned website
  for (const name of ownedWebsiteNames) {
    const desired = new Set(desiredDomainsByWebsite.get(name) ?? []);
    const existingDomains = existingDomainsByWebsite.get(name) ?? [];
    const existingSet = new Set(existingDomains.map((d) => d.domain));
    const sdkOwnedDomains = new Set(
      existingDomains
        .filter((d) => isOwnedByApp(d.allLabels, application.name, application.id))
        .map((d) => d.domain),
    );

    for (const domain of desired) {
      if (!existingSet.has(domain)) {
        const metaRequest = await buildMetaRequest({
          trn: customDomainTrn(workspaceId, name, domain),
          appName: application.name,
          appId: application.id,
        });
        customDomainChangeSet.creates.push({
          name: domain,
          request: { workspaceId, staticWebsiteName: name, domain },
          metaRequest,
        });
      } else {
        customDomainChangeSet.unchanged.push({ name: domain });
      }
    }

    // Only remove SDK-owned domains not in desired if customDomains is explicitly specified
    if (desiredDomainsByWebsite.has(name)) {
      for (const domain of sdkOwnedDomains) {
        if (!desired.has(domain)) {
          customDomainChangeSet.deletes.push({
            name: domain,
            request: { workspaceId, domain },
          });
        }
      }
    }
  }

  return { changeSet, customDomainChangeSet, conflicts, unmanaged, resourceOwners };
}
