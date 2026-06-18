import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "#/cli/shared/client";
import { isOwnedByApp, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";

type ResourcePageFetcher<T> = (pageToken: string, maxPageSize: number) => Promise<[T[], string]>;

export interface FetchExistingResourcesWithLabelsParams<T> {
  client: OperatorClient;
  workspaceId: string;
  fetchPage: ResourcePageFetcher<T>;
  getName: (resource: T) => string | undefined;
  getTrn: (workspaceId: string, name: string) => string;
}

/**
 * Fetch a workspace-scoped resource list and attach SDK ownership metadata.
 * @template T
 * @param params - Resource fetch parameters
 * @param params.client - Operator client instance
 * @param params.workspaceId - Workspace ID
 * @param params.fetchPage - Function that fetches one resource page
 * @param params.getName - Function that extracts the resource name
 * @param params.getTrn - Function that builds the resource TRN
 * @returns Existing resources keyed by resource name, with SDK labels attached
 */
export async function fetchExistingResourcesWithLabels<T>(
  params: FetchExistingResourcesWithLabelsParams<T>,
): Promise<WithLabel<T>> {
  const { client, workspaceId, fetchPage, getName, getTrn } = params;
  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      return await fetchPage(pageToken, maxPageSize);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingResources: WithLabel<T> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const name = getName(resource);
      if (!name) {
        return;
      }
      const { metadata } = await client.getMetadata({
        trn: getTrn(workspaceId, name),
      });
      existingResources[name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );
  return existingResources;
}

export interface TrackDesiredResourceOwnershipParams {
  labels: Record<string, string> | undefined;
  ownerLabel: string | undefined;
  appName: string;
  appId: string | undefined;
  resourceType: string;
  resourceName: string;
  conflicts: OwnerConflict[];
  unmanaged: UnmanagedResource[];
}

/**
 * Determine whether a same-named existing resource is managed by this app.
 * Records the user-facing confirmation data when ownership does not match.
 * @param params - Ownership classification inputs
 * @param params.labels - Existing resource labels
 * @param params.ownerLabel - Existing `sdk-name` label, when present
 * @param params.appName - Current application name
 * @param params.appId - Current application id, when present
 * @param params.resourceType - Resource kind for confirmation messages
 * @param params.resourceName - Resource name for confirmation messages
 * @param params.conflicts - Conflict accumulator
 * @param params.unmanaged - Unmanaged-resource accumulator
 * @returns True when the resource is owned by the current app
 */
export function trackDesiredResourceOwnership(
  params: TrackDesiredResourceOwnershipParams,
): boolean {
  const { labels, ownerLabel, appName, appId, resourceType, resourceName, conflicts, unmanaged } =
    params;
  const owned = isOwnedByApp(labels, appName, appId);
  if (!owned) {
    if (!ownerLabel) {
      unmanaged.push({ resourceType, resourceName });
    } else {
      conflicts.push({
        resourceType,
        resourceName,
        currentOwner: ownerLabel,
      });
    }
  }
  return owned;
}

export interface TrackRemainingResourceOwnerParams {
  labels: Record<string, string> | undefined;
  ownerLabel: string | undefined;
  appName: string;
  appId: string | undefined;
  resourceOwners: Set<string>;
}

/**
 * Determine whether a remote-only resource is still owned by this app.
 * Also records other SDK owners so renamed-empty applications can be handled.
 * @param params - Ownership classification inputs
 * @param params.labels - Existing resource labels
 * @param params.ownerLabel - Existing `sdk-name` label, when present
 * @param params.appName - Current application name
 * @param params.appId - Current application id, when present
 * @param params.resourceOwners - Other-owner accumulator
 * @returns True when the resource is owned by the current app
 */
export function trackRemainingResourceOwner(params: TrackRemainingResourceOwnerParams): boolean {
  const { labels, ownerLabel, appName, appId, resourceOwners } = params;
  const owned = isOwnedByApp(labels, appName, appId);
  if (ownerLabel && !owned) {
    resourceOwners.add(ownerLabel);
  }
  return owned;
}
