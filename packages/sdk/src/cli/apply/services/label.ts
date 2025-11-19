import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export type WithLabel<T> = Partial<
  Record<
    string,
    {
      resource: T;
      label: string | undefined;
    }
  >
>;

export function trnPrefix(workspaceId: string): string {
  return `trn:v1:workspace:${workspaceId}`;
}

export const sdkNameLabelKey = "sdk-name";

export function metaRequest(
  trn: string,
  appName: string,
): MessageInitShape<typeof SetMetadataRequestSchema> {
  return {
    trn,
    labels: {
      "sdk-name": appName,
    },
  };
}
