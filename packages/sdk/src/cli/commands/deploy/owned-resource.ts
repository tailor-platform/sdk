import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { isOwnedByApp, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";

type ResourcePageFetcher<T> = (pageToken: string, maxPageSize: number) => Promise<[T[], string]>;

export interface FetchExistingResourcesWithLabelsParams<T> {
  client: OperatorClient;
  fetchPage: ResourcePageFetcher<T>;
  getName: (resource: T) => string | undefined;
  getTrn: (name: string) => string;
}

/**
 * Fetch a workspace-scoped resource list and attach SDK ownership metadata.
 * @template T
 * @param params - Resource fetch parameters
 * @param params.client - Operator client instance
 * @param params.fetchPage - Function that fetches one resource page
 * @param params.getName - Function that extracts the resource name
 * @param params.getTrn - Function that builds the resource TRN
 * @returns Existing resources keyed by resource name, with SDK labels attached
 */
export async function fetchExistingResourcesWithLabels<T>(
  params: FetchExistingResourcesWithLabelsParams<T>,
): Promise<WithLabel<T>> {
  const { client, fetchPage, getName, getTrn } = params;
  const withoutLabel = await fetchAllTolerant(fetchPage);
  const existingResources: WithLabel<T> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const name = getName(resource);
      if (!name) {
        return;
      }
      const { metadata } = await client.getMetadata({
        trn: getTrn(name),
      });
      existingResources[name] = { resource, allLabels: metadata?.labels };
    }),
  );
  return existingResources;
}

export interface OwnershipResult {
  conflicts: OwnerConflict[];
  unmanaged: UnmanagedResource[];
  resourceOwners: Set<string>;
}

export interface OwnershipTracker {
  /** Confirmation data recorded so far, in the shape plan results carry. */
  result: OwnershipResult;
  /**
   * Determine whether a same-named existing resource is managed by this app.
   * Records the user-facing confirmation data when ownership does not match.
   * @param labels - Existing resource labels
   * @param resource - Resource kind and name for confirmation messages
   * @returns True when the resource is owned by the current app
   */
  ownsDesired(labels: Record<string, string> | undefined, resource: UnmanagedResource): boolean;
  /**
   * Determine whether a remote-only resource is still owned by this app.
   * Also records other SDK owners so renamed-empty applications can be handled.
   * @param labels - Existing resource labels
   * @returns True when the resource is owned by the current app
   */
  ownsRemaining(labels: Record<string, string> | undefined): boolean;
}

/**
 * Create the ownership bookkeeping one planner shares across its resources.
 * @param appName - Current application name
 * @param appId - Current application id, when present
 * @returns Tracker classifying resources and accumulating confirmation data
 */
export function createOwnershipTracker(
  appName: string,
  appId: string | undefined,
): OwnershipTracker {
  const result: OwnershipResult = { conflicts: [], unmanaged: [], resourceOwners: new Set() };
  return {
    result,
    ownsDesired(labels, resource) {
      if (isOwnedByApp(labels, appName, appId)) return true;
      const currentOwner = labels?.[sdkNameLabelKey];
      if (currentOwner) {
        result.conflicts.push({ ...resource, currentOwner });
      } else {
        result.unmanaged.push(resource);
      }
      return false;
    },
    ownsRemaining(labels) {
      if (isOwnedByApp(labels, appName, appId)) return true;
      const owner = labels?.[sdkNameLabelKey];
      if (owner) result.resourceOwners.add(owner);
      return false;
    },
  };
}
