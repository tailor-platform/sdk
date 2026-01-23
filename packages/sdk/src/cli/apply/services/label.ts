import { readPackageJson } from "@/cli/utils/package-json";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

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
export function trnPrefix(workspaceId: string): string {
  return `trn:v1:workspace:${workspaceId}`;
}

export const sdkNameLabelKey = "sdk-name";

/**
 * Build metadata request with SDK labels.
 * @param trn - Target TRN
 * @param appName - Application name label
 * @param existingLabels - Existing labels to preserve (optional)
 * @returns Metadata request
 */
export async function buildMetaRequest(
  trn: string,
  appName: string,
  existingLabels?: Record<string, string>,
): Promise<MessageInitShape<typeof SetMetadataRequestSchema>> {
  const packageJson = await readPackageJson();
  // Format version to be suitable for label value
  const sdkVersion = packageJson.version
    ? `v${packageJson.version.replace(/\./g, "-")}`
    : "unknown";

  return {
    trn,
    labels: {
      ...(existingLabels ?? {}),
      [sdkNameLabelKey]: appName,
      "sdk-version": sdkVersion,
    },
  };
}
