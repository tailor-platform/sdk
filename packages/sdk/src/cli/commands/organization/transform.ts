import { formatTimestamp } from "@/cli/shared/format";
import type { ListUserOrganizationsResponse_UserOrganization } from "@tailor-proto/tailor/v1/workspace_pb";
import type { Organization, Folder } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface UserOrganizationInfo {
  organizationId: string;
  organizationName: string;
  rootFolderId: string;
  rootFolderName: string;
  displayName: string;
}

export interface OrganizationInfo {
  id: string;
  name: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface FolderListInfo {
  id: string;
  name: string;
  organizationId: string;
  parentFolderId: string;
  hasChildren: boolean;
  createdAt: Date | null;
}

export interface FolderInfo extends FolderListInfo {
  updatedAt: Date | null;
}

export const userOrganizationInfo = (
  org: ListUserOrganizationsResponse_UserOrganization,
): UserOrganizationInfo => ({
  organizationId: org.organizationId,
  organizationName: org.organizationName,
  rootFolderId: org.rootFolderId,
  rootFolderName: org.rootFolderName,
  displayName: org.displayName,
});

export const organizationInfo = (org: Organization): OrganizationInfo => ({
  id: org.id,
  name: org.name,
  createdAt: formatTimestamp(org.createTime),
  updatedAt: formatTimestamp(org.updateTime),
});

export const folderListInfo = (folder: Folder): FolderListInfo => ({
  id: folder.id,
  name: folder.name,
  organizationId: folder.organizationId,
  parentFolderId: folder.parentFolderId,
  hasChildren: folder.hasChildren,
  createdAt: formatTimestamp(folder.createTime),
});

export const folderInfo = (folder: Folder): FolderInfo => ({
  ...folderListInfo(folder),
  updatedAt: formatTimestamp(folder.updateTime),
});
