import { Code, ConnectError } from "@connectrpc/connect";
import { withBundleConcurrency } from "@/cli/shared/bundle-concurrency";
import { formatTimestamp } from "@/cli/shared/format";
import { logger, type FieldTransformer } from "@/cli/shared/logger";
import type { OperatorClient } from "@/cli/shared/client";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface WorkspaceInfo {
  id: string;
  name: string;
  folderName?: string;
  region: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface WorkspaceDetails extends WorkspaceInfo {
  deleteProtection: boolean;
  organizationId: string;
  folderId: string;
}

export const workspaceInfo = (workspace: Workspace, folderName?: string): WorkspaceInfo => {
  const info = {
    id: workspace.id,
    name: workspace.name,
    region: workspace.region,
    createdAt: formatTimestamp(workspace.createTime),
    updatedAt: formatTimestamp(workspace.updateTime),
  };
  return folderName ? { ...info, folderName } : info;
};

export const workspaceDetails = (workspace: Workspace, folderName?: string): WorkspaceDetails => {
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
): Promise<string | undefined> {
  if (!workspace.organizationId || !workspace.folderId) return undefined;

  try {
    const response = await client.getOrganizationFolder({
      organizationId: workspace.organizationId,
      folderId: workspace.folderId,
    });

    return response.folder?.name || undefined;
  } catch (error) {
    if (
      error instanceof ConnectError &&
      (error.code === Code.NotFound || error.code === Code.PermissionDenied)
    ) {
      return undefined;
    }
    logger.warn(`Failed to resolve workspace folder name: ${error}`);
    return undefined;
  }
}

export function createWorkspaceFolderNameResolver(client: OperatorClient) {
  const cache = new Map<string, Promise<string | undefined>>();

  return (workspace: Workspace): Promise<string | undefined> => {
    if (!workspace.organizationId || !workspace.folderId) return Promise.resolve(undefined);

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
  return withBundleConcurrency(workspaces, async (workspace) =>
    workspaceInfo(workspace, await resolveFolderName(workspace)),
  );
}

export function workspaceDisplayName(workspace: Pick<WorkspaceInfo, "name" | "folderName">) {
  return workspace.folderName ? `${workspace.folderName}/${workspace.name}` : workspace.name;
}

export function createWorkspaceNameTransformer(
  nameKey: string,
  folderNameKey: string,
): NonNullable<FieldTransformer> {
  return (value: unknown, item: object): string => {
    const workspace = item as Record<string, unknown>;
    const name = workspace[nameKey];
    const folderName = workspace[folderNameKey];
    if (typeof name === "string" && typeof folderName === "string") {
      return workspaceDisplayName({ name, folderName });
    }
    return String(value ?? "");
  };
}

export const workspaceNameTransformer = createWorkspaceNameTransformer("name", "folderName");
