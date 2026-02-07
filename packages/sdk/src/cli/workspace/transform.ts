import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface WorkspaceInfo {
  id: string;
  name: string;
  region: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const formatTimestamp = (timestamp: Timestamp | undefined): Date | null => {
  if (!timestamp) {
    return null;
  }
  const date = timestampDate(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
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
