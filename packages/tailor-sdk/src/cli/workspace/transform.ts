import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

interface WorkspaceInfo {
  id: string;
  name: string;
  region: string;
  createdAt: string;
  updatedAt: string;
}

export const workspaceInfo = (workspace: Workspace): WorkspaceInfo => {
  return {
    id: workspace.id,
    name: workspace.name,
    region: workspace.region,
    createdAt: workspace.createTime
      ? timestampDate(workspace.createTime).toISOString()
      : "N/A",
    updatedAt: workspace.updateTime
      ? timestampDate(workspace.updateTime).toISOString()
      : "N/A",
  };
};
