import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import {
  type DeployOwner,
  deployedByApplication,
  isOwnedBy,
  isWorkspaceManaged,
  appIdOfLabelValue,
  sdkAppIdLabelKey,
  sdkNameLabelKey,
  type WithLabel,
} from "./label";
import { MANAGED_RESOURCE_LABELS } from "./managed-resource-type";
import type { OwnerConflict, UnmanagedResource, WorkspaceTakeover } from "./confirm";

/** The kind and name of a resource whose ownership a planner checks. */
type TrackedResource = Pick<UnmanagedResource, "resourceType" | "resourceName">;

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
  /** Resources an application deployed that the workspace takes over or deletes. */
  takeovers: WorkspaceTakeover[];
  resourceOwners: Set<string>;
}

export interface OwnershipTracker {
  /** Confirmation data recorded so far, in the shape plan results carry. */
  result: OwnershipResult;
  /**
   * Determine whether the deploy's owner manages a same-named existing resource.
   * Records the user-facing confirmation data when ownership does not match.
   * @param labels - Existing resource labels
   * @param resource - Resource kind and name for confirmation messages
   * @returns True when the owner manages the resource
   */
  ownsDesired(labels: Record<string, string> | undefined, resource: TrackedResource): boolean;
  /**
   * Determine whether deploy deletes a remote-only resource: one the owner manages, or, for the
   * workspace, one an application deployed with an id, which it records as a takeover deletion.
   * Also records other SDK owners so renamed-empty applications can be handled.
   * @param labels - Existing resource labels
   * @param resource - Resource kind and name for confirmation messages
   * @returns True when deploy deletes the resource
   */
  ownsRemaining(labels: Record<string, string> | undefined, resource: TrackedResource): boolean;
}

/**
 * Create the ownership bookkeeping one planner shares across its resources.
 *
 * For the workspace, a resource an application deployed (it carries `sdk-name` or `sdk-app-id`
 * but no workspace mark) is taken over when the config has it, and deleted when the config does
 * not and it carries `sdk-app-id`.
 * @param owner - Owner of the resources the deploy manages
 * @returns Tracker classifying resources and accumulating confirmation data
 */
export function createOwnershipTracker(owner: DeployOwner): OwnershipTracker {
  const result: OwnershipResult = {
    conflicts: [],
    unmanaged: [],
    takeovers: [],
    resourceOwners: new Set(),
  };
  const describe = (resource: TrackedResource) => ({
    ...resource,
    resourceLabel: MANAGED_RESOURCE_LABELS[resource.resourceType],
  });
  const takeover = (
    labels: Record<string, string>,
    resource: TrackedResource,
    action: WorkspaceTakeover["action"],
  ) => {
    const currentOwner = labels[sdkNameLabelKey];
    const appIdLabel = labels[sdkAppIdLabelKey];
    result.takeovers.push({
      ...describe(resource),
      action,
      ...(currentOwner && { currentOwner }),
      ...(appIdLabel && { currentAppId: appIdOfLabelValue(appIdLabel) }),
    });
  };
  return {
    result,
    ownsDesired(labels, resource) {
      if (isOwnedBy(labels, owner)) return true;
      const currentOwner = labels?.[sdkNameLabelKey];
      if (owner.kind === "workspace" && labels && deployedByApplication(labels)) {
        takeover(labels, resource, "update");
      } else if (owner.kind === "application" && currentOwner) {
        result.conflicts.push({ ...describe(resource), currentOwner });
      } else {
        result.unmanaged.push({
          ...describe(resource),
          ...(isWorkspaceManaged(labels) && { managedBy: "workspace" as const }),
        });
      }
      return false;
    },
    ownsRemaining(labels, resource) {
      if (isOwnedBy(labels, owner)) return true;
      if (owner.kind === "workspace") {
        if (!labels || !deployedByApplication(labels) || !labels[sdkAppIdLabelKey]) return false;
        takeover(labels, resource, "delete");
        return true;
      }
      const currentOwner = labels?.[sdkNameLabelKey];
      if (currentOwner) result.resourceOwners.add(currentOwner);
      return false;
    },
  };
}
