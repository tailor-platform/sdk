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
 * @param labels - Labels currently stored on the remote resource
 * @returns Recorded dependencies, in label-key order
 */
export function recordedDependencies(
  labels: Record<string, string> | undefined,
): RecordedDependency[] {
  if (!labels) return [];
  return Object.entries(labels)
    .filter(([key]) => key.startsWith(dependedByAppLabelPrefix))
    .map(([key, reason]) => ({ appId: key.slice(dependedByAppLabelPrefix.length), reason }));
}

export interface BuildMetaRequestParams {
  trn: string;
  appName: string;
  appId?: string;
  existingLabels?: Record<string, string>;
  /** Extra labels written alongside the SDK labels. */
  extraLabels?: Record<string, string>;
}

/**
 * Build metadata request with SDK labels.
 * @param params - Parameters for building the metadata request
 * @param params.trn - Target TRN
 * @param params.appName - Application name label
 * @param params.appId - Stable application id label (when managed by SDK)
 * @param params.existingLabels - Existing labels to preserve (optional)
 * @param params.extraLabels - Extra labels written alongside the SDK labels (optional)
 * @returns Metadata request
 */
export async function buildMetaRequest(
  params: BuildMetaRequestParams,
): Promise<MessageInitShape<typeof SetMetadataRequestSchema>> {
  const { trn, appName, appId, existingLabels, extraLabels } = params;
  const packageJson = await readPackageJson();
  // Format version to be suitable for label value
  const sdkVersion = packageJson.version
    ? `v${packageJson.version.replace(/\./g, "-")}`
    : "unknown";

  return {
    trn,
    labels: {
      ...existingLabels,
      [sdkNameLabelKey]: appName,
      [sdkVersionLabelKey]: sdkVersion,
      ...(appId ? { [sdkAppIdLabelKey]: toAppIdLabelValue(appId) } : {}),
      ...extraLabels,
    },
  };
}
