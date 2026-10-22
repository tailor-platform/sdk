import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type AddCustomDomainRequestSchema,
  type CancelCustomDomainTransferRequestSchema,
  type CreateStaticWebsiteRequestSchema,
  type DeleteStaticWebsiteRequestSchema,
  type RemoveCustomDomainRequestSchema,
  type RequestCustomDomainTransferRequestSchema,
  type UpdateStaticWebsiteRequestSchema,
} from "@tailor-platform/tailor-proto/staticwebsite_pb";
import {
  CustomDomainStatus,
  CustomDomainTransferStatus,
} from "@tailor-platform/tailor-proto/staticwebsite_resource_pb";
import { fetchAllTolerant, getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import {
  buildMetaRequest,
  hasMatchingSdkVersion,
  isOwnedByApp,
  type MetadataLabelWrite,
  resourceTrn,
  sdkNameLabelKey,
  writeMetadataLabels,
} from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type {
  CustomDomainTransfer,
  StaticWebsite as ProtoStaticWebsite,
} from "@tailor-platform/tailor-proto/staticwebsite_resource_pb";

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
  const { changeSet, customDomainChangeSet, customDomainTransferChangeSet } = result;
  if (phase === "create-update") {
    // StaticWebsites
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await client.createStaticWebsite(create.request);
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateStaticWebsite(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
    ]);
    // Custom domains. Adds may complete a transfer; adoptions only write labels.
    await Promise.all([
      ...customDomainChangeSet.creates.map(async (add) => {
        const { transfer } = await client.addCustomDomain(add.request);
        await writeMetadataLabels(client, add.metaRequest);
        if (transfer) {
          logger.info(
            `Custom domain "${add.name}" was transferred from workspace ${transfer.sourceWorkspaceId}.`,
          );
        }
      }),
      ...customDomainChangeSet.updates.map((adopt) =>
        writeMetadataLabels(client, adopt.metaRequest),
      ),
    ]);
    await Promise.all(
      customDomainChangeSet.deletes.map((del) => client.removeCustomDomain(del.request)),
    );
    // A retargeted domain's old offer must be withdrawn before the new one opens.
    await Promise.all(
      customDomainTransferChangeSet.deletes.map((cancel) =>
        client.cancelCustomDomainTransfer(cancel.request),
      ),
    );
    await Promise.all(
      customDomainTransferChangeSet.creates.map((request) =>
        client.requestCustomDomainTransfer(request.request),
      ),
    );
  } else {
    // Delete in reverse order of dependencies
    // StaticWebsites
    await Promise.all(changeSet.deletes.map((del) => client.deleteStaticWebsite(del.request)));
  }
}

type CreateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof CreateStaticWebsiteRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof UpdateStaticWebsiteRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteStaticWebsite = {
  name: string;
  request: MessageInitShape<typeof DeleteStaticWebsiteRequestSchema>;
};

type AddCustomDomainEntry = {
  name: string;
  request: MessageInitShape<typeof AddCustomDomainRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type RemoveCustomDomainEntry = {
  name: string;
  request: MessageInitShape<typeof RemoveCustomDomainRequestSchema>;
};

/**
 * An existing custom domain this application takes ownership of. The domain
 * itself is unchanged; only its metadata labels are written.
 */
type AdoptCustomDomainEntry = {
  name: string;
  metaRequest: MetadataLabelWrite;
  details?: readonly string[];
};

type RequestCustomDomainTransferEntry = {
  name: string;
  staticWebsiteName: string;
  request: MessageInitShape<typeof RequestCustomDomainTransferRequestSchema>;
  details?: readonly string[];
};

type CancelCustomDomainTransferEntry = {
  name: string;
  staticWebsiteName: string;
  request: MessageInitShape<typeof CancelCustomDomainTransferRequestSchema>;
  details?: readonly string[];
};

/** A custom domain declared in config, with its transfer intent when it has one. */
type DesiredCustomDomain = {
  domain: string;
  transferToWorkspaceId?: string;
};

/** Why a custom domain produced no change in this plan. */
export type CustomDomainNoteKind =
  | "transfer-pending"
  | "transfer-purge-outstanding"
  | "transfer-completed"
  | "transfer-not-completed"
  | "transfer-source-removing";

/**
 * A plan-time remark about a custom domain that produced no change. Change-set
 * `details` only render for items in creates/deletes/updates/replaces, so a row
 * that plans nothing needs its own channel to reach the user.
 */
export type CustomDomainNote = {
  kind: CustomDomainNoteKind;
  staticWebsiteName: string;
  domain: string;
  message: string;
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

const TRANSFER_STATUS_WORDS: Partial<Record<CustomDomainTransferStatus, string>> = {
  [CustomDomainTransferStatus.COMPLETED]: "completed",
  [CustomDomainTransferStatus.CANCELLED]: "was cancelled",
  [CustomDomainTransferStatus.EXPIRED]: "expired",
};

function describePreviousTransfer(transfer: CustomDomainTransfer): string {
  const word = TRANSFER_STATUS_WORDS[transfer.status] ?? "ended";
  return `a previous transfer to workspace ${transfer.targetWorkspaceId} ${word}`;
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
 * Static website names expected to exist after this deploy run.
 * @param context - Planning context
 * @returns Names from the deploy-run scope when set, otherwise the application's own websites
 */
export function expectedLocalStaticWebsiteNames(context: PlanContext): ReadonlySet<string> {
  return (
    context.expectedLocalStaticWebsiteNames ??
    new Set(context.application.staticWebsiteServices.map((website) => website.name))
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
    AdoptCustomDomainEntry,
    RemoveCustomDomainEntry
  >("CustomDomains");
  const customDomainTransferChangeSet = createChangeSet<
    RequestCustomDomainTransferEntry,
    never,
    CancelCustomDomainTransferEntry
  >("CustomDomainTransfers");
  const customDomainNotes: CustomDomainNote[] = [];
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const existingWebsites = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, pageSize) => {
      const { staticwebsites, nextPageToken } = await client.listStaticWebsites({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [staticwebsites, nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (name) => resourceTrn(workspaceId, "staticwebsite", name),
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
        resourceType: "staticwebsite",
        resourceLabel: "StaticWebsite",
        resourceName: name,
        conflicts,
        unmanaged,
      });

      const configUnchanged = owned && areStaticWebsitesEqual(existing.resource, desired);
      if (configUnchanged && hasMatchingSdkVersion(existing.allLabels, metaRequest.labels)) {
        changeSet.unchanged.push({ name });
      } else {
        changeSet.updates.push({
          name,
          request,
          metaRequest,
          ...(configUnchanged && { forcedBySdkVersion: true }),
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
  const desiredDomainsByWebsite = new Map<string, Map<string, DesiredCustomDomain>>();
  for (const service of staticWebsiteServices) {
    if (service.customDomains !== undefined && ownedWebsiteNames.has(service.name)) {
      desiredDomainsByWebsite.set(
        service.name,
        new Map(
          service.customDomains.map((entry) => {
            const desired: DesiredCustomDomain =
              typeof entry === "string"
                ? { domain: entry }
                : { domain: entry.domain, transferToWorkspaceId: entry.transferTo.workspaceId };
            return [desired.domain, desired];
          }),
        ),
      );
    }
  }

  // Fetch existing custom domains and their labels for owned websites that already exist
  type ExistingDomainInfo = {
    domain: string;
    status: CustomDomainStatus;
    allLabels: Record<string, string> | undefined;
  };
  const existingDomainsByWebsite = new Map<string, ExistingDomainInfo[]>();
  const websitesToFetchDomains = [...ownedWebsiteNames].filter(
    (name) => !changeSet.creates.some((c) => c.name === name),
  );
  const fetchExistingDomains = Promise.all(
    websitesToFetchDomains.map(async (name) => {
      // Only the list is tolerant of NotFound: wrapping the metadata reads too
      // would drop a whole site's domains — and so its adoptions and conflicts —
      // on one missing label record.
      const customDomains = await getOrNull(async () => {
        const { customDomains: domains } = await client.listCustomDomains({
          workspaceId,
          staticWebsiteName: name,
        });
        return domains;
      });
      if (!customDomains) {
        return;
      }
      const domainsWithLabels = await Promise.all(
        customDomains.map(async (d) => {
          const { metadata } = await client.getMetadata({
            trn: customDomainTrn(workspaceId, name, d.domain),
          });
          return { domain: d.domain, status: d.status, allLabels: metadata?.labels };
        }),
      );
      existingDomainsByWebsite.set(name, domainsWithLabels);
    }),
  );

  // Live offers this workspace made, read once. The RPC also returns offers made
  // *to* this workspace; cancelling one of those from the source lane would
  // withdraw someone else's offer, so filter to our own.
  const planningAnyDomains = desiredDomainsByWebsite.size > 0;
  const hasTransferIntent = [...desiredDomainsByWebsite.values()].some((entries) =>
    [...entries.values()].some((entry) => entry.transferToWorkspaceId !== undefined),
  );
  const fetchLiveOffers = planningAnyDomains
    ? fetchAllTolerant<CustomDomainTransfer>(async (pageToken, pageSize) => {
        const { transfers, nextPageToken } = await client.listCustomDomainTransfers({
          workspaceId,
          status: CustomDomainTransferStatus.PENDING,
          pageToken,
          pageSize,
        });
        return [transfers, nextPageToken];
      }).catch((error: unknown) => {
        // An older platform has no transfer RPCs. Configs that only list plain
        // domains must keep deploying; a transfer intent cannot be honoured.
        if (error instanceof ConnectError && error.code === Code.Unimplemented) {
          if (hasTransferIntent) {
            throw CLIError({
              code: "CUSTOM_DOMAIN_TRANSFER_UNSUPPORTED",
              message: "This Platform does not support custom domain transfers.",
              suggestion: "Remove the `transferTo` entries from `customDomains`.",
              cause: error,
            });
          }
          logger.debug("Platform does not support custom domain transfers; skipping.");
          return [];
        }
        throw error;
      })
    : Promise.resolve<CustomDomainTransfer[]>([]);

  const [, liveOffers] = await Promise.all([fetchExistingDomains, fetchLiveOffers]);
  const liveOffersByDomain = new Map(
    liveOffers
      .filter((transfer) => transfer.sourceWorkspaceId === workspaceId)
      .map((transfer) => [transfer.domain, transfer]),
  );

  // For each transfer intent with no live offer, the domain's latest record.
  // It never suppresses a request; it only explains what happened last time.
  const intentsNeedingHistory = new Set<string>();
  for (const entries of desiredDomainsByWebsite.values()) {
    for (const entry of entries.values()) {
      if (entry.transferToWorkspaceId !== undefined && !liveOffersByDomain.has(entry.domain)) {
        intentsNeedingHistory.add(entry.domain);
      }
    }
  }
  const latestTransferByDomain = new Map<string, CustomDomainTransfer>();
  await Promise.all(
    [...intentsNeedingHistory].map(async (domain) => {
      const result = await getOrNull(() => client.getCustomDomainTransfer({ workspaceId, domain }));
      if (result?.transfer) {
        latestTransferByDomain.set(domain, result.transfer);
      }
    }),
  );

  // Diff custom domains for each owned website
  for (const name of ownedWebsiteNames) {
    const desiredEntries =
      desiredDomainsByWebsite.get(name) ?? new Map<string, DesiredCustomDomain>();
    const existingDomains = existingDomainsByWebsite.get(name) ?? [];
    const existingByDomain = new Map(existingDomains.map((d) => [d.domain, d]));
    const sdkOwnedDomains = new Set(
      existingDomains
        .filter((d) => isOwnedByApp(d.allLabels, application.name, application.id))
        .map((d) => d.domain),
    );

    // Presence: create what is missing, adopt what we do not own yet.
    for (const [domain, entry] of desiredEntries) {
      const existing = existingByDomain.get(domain);

      if (existing?.status === CustomDomainStatus.REMOVING) {
        customDomainChangeSet.unchanged.push({ name: domain });
        customDomainNotes.push({
          kind: "transfer-source-removing",
          staticWebsiteName: name,
          domain,
          message:
            "the domain is being removed; delete this entry or wait for the removal to finish",
        });
        continue;
      }

      if (!existing) {
        // A transfer intent never adds the domain: it offers one this site holds.
        if (entry.transferToWorkspaceId !== undefined) {
          continue;
        }
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
        continue;
      }

      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.allLabels?.[sdkNameLabelKey],
        appName: application.name,
        appId: application.id,
        resourceType: "staticwebsite.custom_domain",
        resourceLabel: "StaticWebsite custom domain",
        resourceName: domain,
        conflicts,
        unmanaged,
      });
      if (owned) {
        customDomainChangeSet.unchanged.push({ name: domain });
      } else {
        customDomainChangeSet.updates.push({
          name: domain,
          metaRequest: await buildMetaRequest({
            trn: customDomainTrn(workspaceId, name, domain),
            appName: application.name,
            appId: application.id,
          }),
          details: ["takes SDK ownership; the domain itself is unchanged"],
        });
      }
    }

    // Only remove SDK-owned domains not in desired if customDomains is explicitly
    // specified. Cancels below are emitted only for domains that *are* desired, so
    // a removal and a cancel can never name the same domain.
    if (desiredDomainsByWebsite.has(name)) {
      for (const domain of sdkOwnedDomains) {
        if (!desiredEntries.has(domain)) {
          customDomainChangeSet.deletes.push({
            name: domain,
            request: { workspaceId, domain },
          });
        }
      }
    }

    // Transfers, decided presence-first.
    for (const [domain, entry] of desiredEntries) {
      const existing = existingByDomain.get(domain);
      if (existing?.status === CustomDomainStatus.REMOVING) {
        continue;
      }
      const offer = liveOffersByDomain.get(domain);
      const target = entry.transferToWorkspaceId;

      if (target === undefined) {
        // Reverted to a plain string: withdraw the offer, keep the domain.
        if (offer) {
          customDomainTransferChangeSet.deletes.push({
            name: domain,
            staticWebsiteName: name,
            request: { workspaceId, domain },
            details: [`withdraws the offer to workspace ${offer.targetWorkspaceId}`],
          });
        }
        continue;
      }

      if (!existing) {
        const latest = latestTransferByDomain.get(domain);
        const completedHere =
          latest?.status === CustomDomainTransferStatus.COMPLETED &&
          latest.sourceWorkspaceId === workspaceId;
        customDomainNotes.push({
          kind: completedHere ? "transfer-completed" : "transfer-not-completed",
          staticWebsiteName: name,
          domain,
          message: completedHere
            ? `transfer to workspace ${latest.targetWorkspaceId} completed — remove this entry`
            : "the transfer did not complete — check this entry",
        });
        continue;
      }

      if (offer && offer.targetWorkspaceId === target) {
        // A live offer is never extended.
        if (offer.requestPurgedAt) {
          customDomainNotes.push({
            kind: "transfer-pending",
            staticWebsiteName: name,
            domain,
            message: `transfer to workspace ${target} is pending`,
          });
        } else {
          customDomainNotes.push({
            kind: "transfer-purge-outstanding",
            staticWebsiteName: name,
            domain,
            message: `transfer to workspace ${target} is pending; edge purge outstanding — the platform retries every 5 min; the target cannot accept until then`,
          });
        }
        continue;
      }

      if (offer) {
        customDomainTransferChangeSet.deletes.push({
          name: domain,
          staticWebsiteName: name,
          request: { workspaceId, domain },
          details: [`withdraws the offer to workspace ${offer.targetWorkspaceId}`],
        });
      }

      const latest = latestTransferByDomain.get(domain);
      customDomainTransferChangeSet.creates.push({
        name: domain,
        staticWebsiteName: name,
        request: { workspaceId, domain, targetWorkspaceId: target },
        details: [
          `offers "${domain}" to workspace ${target}`,
          ...(offer ? [`replaces the offer to workspace ${offer.targetWorkspaceId}`] : []),
          ...(latest && !offer ? [describePreviousTransfer(latest)] : []),
        ],
      });
    }
  }

  return {
    changeSet,
    customDomainChangeSet,
    customDomainTransferChangeSet,
    customDomainNotes,
    customDomainLiveOffers: liveOffersByDomain,
    conflicts,
    unmanaged,
    resourceOwners,
  };
}
