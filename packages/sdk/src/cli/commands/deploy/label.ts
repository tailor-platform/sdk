import { getOrNull } from "#/cli/shared/client";
import { readPackageJson } from "#/cli/shared/package-json";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";

export type WithLabel<T> = Partial<
  Record<
    string,
    {
      resource: T;
      label: string | undefined;
      allLabels?: Record<string, string>;
    }
  >
>;

/**
 * Build TRN prefix for a workspace.
 * @param workspaceId - Workspace ID
 * @returns TRN prefix string
 */
function trnPrefix(workspaceId: string): string {
  return `trn:v1:workspace:${workspaceId}`;
}

/**
 * Resource kind segment used in a TRN (`trn:v1:workspace:<id>:<kind>:<name>`).
 */
export type ResourceKind =
  | "application"
  | "function_registry"
  | "pipeline"
  | "idp"
  | "auth"
  | "auth_connection"
  | "executor"
  | "workflow"
  | "workflow_job_function"
  | "workflow_job_function_execution_policy"
  | "staticwebsite"
  | "aigateway"
  | "tailordb"
  | "vault";

/**
 * Build the TRN for a workspace resource.
 * @param workspaceId - Workspace ID
 * @param kind - Resource kind segment
 * @param name - Resource name
 * @returns Fully-qualified TRN string
 */
export function resourceTrn(workspaceId: string, kind: ResourceKind, name: string): string {
  return `${trnPrefix(workspaceId)}:${kind}:${name}`;
}

export const sdkNameLabelKey = "sdk-name";
export const sdkVersionLabelKey = "sdk-version";
export const sdkAppIdLabelKey = "sdk-app-id";

// The metadata label value regex requires a leading lowercase letter, while
// the auto-generated app id is a plain UUID (which may start with a digit).
// The `app-` prefix is added at the metadata boundary so the user-facing id
// in `tailor.config.ts` can stay a plain UUID.
const appIdLabelPrefix = "app-";

function toAppIdLabelValue(appId: string): string {
  return `${appIdLabelPrefix}${appId}`;
}

/**
 * Check whether existing metadata was produced by the current SDK version.
 * @param existingLabels - Labels currently stored on the remote resource
 * @param desiredLabels - Labels that will be written by the current apply run
 * @returns True when sdk-version matches
 */
export function hasMatchingSdkVersion(
  existingLabels: Record<string, string> | undefined,
  desiredLabels: Record<string, string> | undefined,
): boolean {
  return existingLabels?.[sdkVersionLabelKey] === desiredLabels?.[sdkVersionLabelKey];
}

/**
 * Determine whether a remote resource is owned by the given application.
 * When the resource carries an `sdk-app-id`, ownership is decided strictly
 * by id match — a resource explicitly tagged with another app's id is
 * NOT ours even if the legacy sdk-name happens to match. Resources without
 * `sdk-app-id` (legacy) fall back to sdk-name comparison.
 * @param labels - Labels currently stored on the remote resource
 * @param appName - Application name from the local config
 * @param appId - Stable application id from the local config (when present)
 * @returns True when the resource is owned by the application
 */
export function isOwnedByApp(
  labels: Record<string, string> | undefined,
  appName: string,
  appId: string | undefined,
): boolean {
  if (!labels) return false;
  const labelAppId = labels[sdkAppIdLabelKey];
  if (labelAppId) {
    return appId !== undefined && labelAppId === toAppIdLabelValue(appId);
  }
  return labels[sdkNameLabelKey] === appName;
}

// Records that another config must take part in the same deploy, because this
// application's resources are applied differently when it does. The dependent
// application's id goes in the key so several can be recorded at once — a label
// value cannot hold a delimited list (values are `^$|^[a-z][a-z0-9_-]{0,62}$`).
const dependedByAppLabelPrefix = "sdk-depended-by-app-";

/** Why a dependent config has to take part in the same deploy. */
export type DeployDependencyReason = "publish-events";

// Label keys are `^[a-z][a-z0-9_-]{0,62}$`, so an id that is not a lowercase
// UUID cannot be recorded. `ensureConfigIdForDeploy` writes canonical UUIDs;
// this guards a hand-edited value rather than silently building an invalid key.
const RECORDABLE_APP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Build the label key recording that an application depends on this deploy.
 * @param appId - Stable id of the dependent application
 * @returns Label key, or undefined when the id cannot form a valid key
 */
export function dependedByAppLabelKey(appId: string): string | undefined {
  return RECORDABLE_APP_ID.test(appId) ? `${dependedByAppLabelPrefix}${appId}` : undefined;
}

/** An application recorded as depending on this deploy. */
export type RecordedDependency = {
  /** Stable id of the dependent application. */
  appId: string;
  /** Why it has to take part in the same deploy. */
  reason: string;
};

/**
 * Read the dependent applications recorded on a resource.
 *
 * Only keys {@link dependedByAppLabelKey} could have written are read back, so a
 * label the SDK could not have produced cannot raise a confirmation prompt that
 * naming no config in the run makes unanswerable.
 * @param labels - Labels currently stored on the remote resource
 * @returns Recorded dependencies, in label-key order
 */
export function recordedDependencies(
  labels: Record<string, string> | undefined,
): RecordedDependency[] {
  if (!labels) return [];
  return Object.entries(labels)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([key, reason]) => {
      if (!key.startsWith(dependedByAppLabelPrefix)) return [];
      const appId = key.slice(dependedByAppLabelPrefix.length);
      return RECORDABLE_APP_ID.test(appId) ? [{ appId, reason }] : [];
    });
}

/** Inputs deciding which dependency records a deploy writes and drops. */
export type DependencyLabelParams = {
  /** Labels currently stored on the application. */
  existingLabels: Record<string, string> | undefined;
  /** Applications this run found depending on the one being planned. */
  dependentApps: ReadonlyMap<string, DeployDependencyReason> | undefined;
  /** Stable ids of every application taking part in the run. */
  runAppIds: ReadonlySet<string> | undefined;
};

/**
 * Split the dependency records into the ones to write and the ones to drop.
 *
 * A record for an application outside the run appears in neither list, so
 * {@link writeMetadataLabels} keeps it: it was written when both took part, and
 * dropping it would lose the only signal that this partial deploy is about to
 * change how the config's resources are applied. A record for an application
 * that does take part is rewritten or dropped, so a dependency that no longer
 * exists disappears on the next deploy including both.
 * @param params - Existing labels and the run's dependency inputs
 * @returns Labels to set and label keys to delete
 */
export function dependencyLabelWrite(
  params: DependencyLabelParams,
): Required<Pick<MetadataLabelWrite, "labels" | "remove">> {
  const { existingLabels, dependentApps, runAppIds } = params;
  const dependents = dependentApps ?? new Map<string, DeployDependencyReason>();
  const inRun = runAppIds ?? new Set<string>();

  const labels: Record<string, string> = {};
  for (const [appId, reason] of dependents) {
    const key = dependedByAppLabelKey(appId);
    if (key) labels[key] = reason;
  }

  const remove = recordedDependencies(existingLabels).flatMap(({ appId }) => {
    if (!inRun.has(appId) || dependents.has(appId)) return [];
    const key = dependedByAppLabelKey(appId);
    return key ? [key] : [];
  });

  return { labels, remove };
}

export interface BuildMetaRequestParams {
  trn: string;
  appName: string;
  appId?: string;
}

/**
 * Build metadata request with SDK labels.
 *
 * Sets only the SDK's own labels; {@link writeMetadataLabels} keeps the rest
 * from the labels it reads at write time.
 * @param params - Parameters for building the metadata request
 * @param params.trn - Target TRN
 * @param params.appName - Application name label
 * @param params.appId - Stable application id label (when managed by SDK)
 * @returns Metadata request
 */
export async function buildMetaRequest(
  params: BuildMetaRequestParams,
): Promise<MetadataLabelWrite> {
  const { trn, appName, appId } = params;
  const packageJson = await readPackageJson();
  // Format version to be suitable for label value
  const sdkVersion = packageJson.version
    ? `v${packageJson.version.replace(/\./g, "-")}`
    : "unknown";

  return {
    trn,
    labels: {
      [sdkNameLabelKey]: appName,
      [sdkVersionLabelKey]: sdkVersion,
      ...(appId ? { [sdkAppIdLabelKey]: toAppIdLabelValue(appId) } : {}),
    },
  };
}

/**
 * The client surface {@link writeMetadataLabels} needs. Narrower than the full
 * operator client so tests can pass a stub and the module stays decoupled.
 */
export interface MetadataLabelClient {
  getMetadata(request: { trn: string }): Promise<{ metadata?: { labels: Record<string, string> } }>;
  setMetadata(request: MessageInitShape<typeof SetMetadataRequestSchema>): Promise<unknown>;
}

/** A metadata label write, expressed as a change rather than a whole map. */
export interface MetadataLabelWrite {
  /** Target TRN. */
  trn: string;
  /** Labels to set. Keys absent here keep whatever the resource already has. */
  labels?: Record<string, string>;
  /** Label keys to delete. Absent keys are ignored. */
  remove?: ReadonlyArray<string>;
}

/**
 * Write metadata labels as a change against the resource's current labels.
 *
 * `SetMetadata` replaces the whole label map, so a request built from labels
 * read earlier deletes anything written in between. This re-reads immediately
 * before writing and applies `labels` and `remove` to what it finds, which is
 * why every label write in the SDK goes through here rather than calling
 * `client.setMetadata` directly.
 *
 * Concurrent writers are still not safe in the strict sense — that needs
 * server-side conditional writes — but a write can no longer be built from
 * state this process read at an unrelated point in time.
 *
 * A write that changes nothing does nothing — whether the caller requested no
 * change or the change turns out to already hold. Writing back what was just
 * read would still overwrite whatever landed in between, for no gain, and the
 * labels the SDK sets are unchanged on most deploys.
 * @param client - Operator client instance
 * @param write - TRN, labels to set, and label keys to delete
 * @returns Promise that resolves when the labels are written
 */
export async function writeMetadataLabels(
  client: MetadataLabelClient,
  write: MetadataLabelWrite,
): Promise<void> {
  const { trn, labels, remove } = write;
  if (!Object.keys(labels ?? {}).length && !(remove ?? []).length) return;
  const current = await getOrNull(() => client.getMetadata({ trn }));
  const currentLabels = current?.metadata?.labels ?? {};
  const merged: Record<string, string> = { ...currentLabels, ...labels };
  for (const key of remove ?? []) {
    delete merged[key];
  }
  if (areSameLabels(currentLabels, merged)) return;
  await client.setMetadata({ trn, labels: merged });
}

function areSameLabels(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
