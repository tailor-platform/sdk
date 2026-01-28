import { formatTimestamp } from "../utils/format";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface WorkspaceInfo {
  id: string;
  name: string;
  region: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDetails extends WorkspaceInfo {
  deleteProtection: boolean;
  organizationId: string;
  folderId: string;
}

export const workspaceInfo = (workspace: Workspace): WorkspaceInfo => {
  return {
    id: workspace.id,
    name: workspace.name,
    region: workspace.region,
    createdAt: formatTimestamp(workspace.createTime),
    updatedAt: formatTimestamp(workspace.updateTime),
  };
};

export const workspaceDetails = (workspace: Workspace): WorkspaceDetails => {
  return {
    ...workspaceInfo(workspace),
    deleteProtection: workspace.deleteProtection,
    organizationId: workspace.organizationId,
    folderId: workspace.folderId,
  };
};
