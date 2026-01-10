import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface WorkspaceInfo {
  id: string;
  name: string;
  region: string;
  createdAt: string;
  updatedAt: string;
}

const formatTimestamp = (timestamp: Timestamp | undefined): string => {
  if (!timestamp) {
    return "N/A";
  }
  const date = timestampDate(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }
  return date.toISOString();
};

export const workspaceInfo = (workspace: Workspace): WorkspaceInfo => {
  return {
    id: workspace.id,
    name: workspace.name,
    region: workspace.region,
    createdAt: formatTimestamp(workspace.createTime),
    updatedAt: formatTimestamp(workspace.updateTime),
  };
};
