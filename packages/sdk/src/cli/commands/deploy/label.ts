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

export interface BuildMetaRequestParams {
  trn: string;
  appName: string;
  appId?: string;
  existingLabels?: Record<string, string>;
}

/**
 * Build metadata request with SDK labels.
 * @param params - Parameters for building the metadata request
 * @param params.trn - Target TRN
 * @param params.appName - Application name label
 * @param params.appId - Stable application id label (when managed by SDK)
 * @param params.existingLabels - Existing labels to preserve (optional)
 * @returns Metadata request
 */
export async function buildMetaRequest(
  params: BuildMetaRequestParams,
): Promise<MessageInitShape<typeof SetMetadataRequestSchema>> {
  const { trn, appName, appId, existingLabels } = params;
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
    },
  };
}
