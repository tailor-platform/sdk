import { formatTimestamp } from "@/cli/shared/format";
import type { OperatorClient } from "@/cli/shared/client";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface WorkspaceInfo {
  id: string;
  name: string;
  folderName: string;
  region: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface WorkspaceDetails extends WorkspaceInfo {
  deleteProtection: boolean;
  organizationId: string;
  folderId: string;
}

export const workspaceInfo = (workspace: Workspace, folderName = ""): WorkspaceInfo => {
  return {
    id: workspace.id,
    name: workspace.name,
    folderName,
    region: workspace.region,
    createdAt: formatTimestamp(workspace.createTime),
    updatedAt: formatTimestamp(workspace.updateTime),
  };
};

export const workspaceDetails = (workspace: Workspace, folderName = ""): WorkspaceDetails => {
  return {
    ...workspaceInfo(workspace, folderName),
    deleteProtection: workspace.deleteProtection,
    organizationId: workspace.organizationId,
    folderId: workspace.folderId,
  };
};

export async function resolveWorkspaceFolderName(
  client: OperatorClient,
  workspace: Workspace,
): Promise<string> {
  if (!workspace.organizationId || !workspace.folderId) return "";

  const response = await client.getOrganizationFolder({
    organizationId: workspace.organizationId,
    folderId: workspace.folderId,
  });

  return response.folder?.name ?? "";
}

export function createWorkspaceFolderNameResolver(client: OperatorClient) {
  const cache = new Map<string, Promise<string>>();

  return (workspace: Workspace): Promise<string> => {
    if (!workspace.organizationId || !workspace.folderId) return Promise.resolve("");

    const cacheKey = `${workspace.organizationId}/${workspace.folderId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const promise = resolveWorkspaceFolderName(client, workspace);
    cache.set(cacheKey, promise);
    return promise;
  };
}

export async function workspaceInfoWithFolderName(
  client: OperatorClient,
  workspace: Workspace,
): Promise<WorkspaceInfo> {
  const folderName = await resolveWorkspaceFolderName(client, workspace);
  return workspaceInfo(workspace, folderName);
}

export async function workspaceDetailsWithFolderName(
  client: OperatorClient,
  workspace: Workspace,
): Promise<WorkspaceDetails> {
  const folderName = await resolveWorkspaceFolderName(client, workspace);
  return workspaceDetails(workspace, folderName);
}

export async function workspaceInfosWithFolderNames(
  client: OperatorClient,
  workspaces: Workspace[],
): Promise<WorkspaceInfo[]> {
  const resolveFolderName = createWorkspaceFolderNameResolver(client);
  return Promise.all(
    workspaces.map(async (workspace) =>
      workspaceInfo(workspace, await resolveFolderName(workspace)),
    ),
  );
}

export function workspaceDisplayName(workspace: Pick<WorkspaceInfo, "name" | "folderName">) {
  return workspace.folderName ? `${workspace.folderName}/${workspace.name}` : workspace.name;
}

export function displayWorkspaceName(value: unknown, item: object): string {
  const workspace = item as Partial<Pick<WorkspaceInfo, "name" | "folderName">>;
  if (typeof workspace.name === "string" && typeof workspace.folderName === "string") {
    return workspaceDisplayName({ name: workspace.name, folderName: workspace.folderName });
  }
  return String(value ?? "");
}
