import { describe, expect, test, vi } from "vitest";
import {
  workspaceDisplayName,
  workspaceInfosWithFolderNames,
  workspaceInfoWithFolderName,
} from "./transform";
import type { OperatorClient } from "@/cli/shared/client";
import type { Workspace } from "@tailor-proto/tailor/v1/workspace_resource_pb";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    name: "sample-space",
    region: "us-west",
    organizationId: "organization-1",
    folderId: "folder-1",
    ...overrides,
  } as Workspace;
}

function client(folderName = "dev"): OperatorClient {
  return {
    getOrganizationFolder: vi.fn().mockResolvedValue({
      folder: {
        name: folderName,
      },
    }),
  } as unknown as OperatorClient;
}

describe("workspace transform", () => {
  test("adds folderName and renders the display name as folder/workspace", async () => {
    const info = await workspaceInfoWithFolderName(client(), workspace());

    expect(info).toMatchObject({
      name: "sample-space",
      folderName: "dev",
    });
    expect(workspaceDisplayName(info)).toBe("dev/sample-space");
  });

  test("falls back to the workspace name when the workspace has no folder", async () => {
    const mockClient = client();
    const info = await workspaceInfoWithFolderName(
      mockClient,
      workspace({ organizationId: "", folderId: "" }),
    );

    expect(info.folderName).toBe("");
    expect(workspaceDisplayName(info)).toBe("sample-space");
    expect(mockClient.getOrganizationFolder).not.toHaveBeenCalled();
  });

  test("falls back to the workspace name when the folder lookup fails", async () => {
    const mockClient = {
      getOrganizationFolder: vi.fn().mockRejectedValue(new Error("permission denied")),
    } as unknown as OperatorClient;
    const info = await workspaceInfoWithFolderName(mockClient, workspace());

    expect(info.folderName).toBe("");
    expect(workspaceDisplayName(info)).toBe("sample-space");
  });

  test("caches folder lookup across workspaces in the same folder", async () => {
    const mockClient = client("stg");
    const infos = await workspaceInfosWithFolderNames(mockClient, [
      workspace({ id: "workspace-1", name: "sample-space" }),
      workspace({ id: "workspace-2", name: "another-space" }),
    ]);

    expect(infos.map(workspaceDisplayName)).toEqual(["stg/sample-space", "stg/another-space"]);
    expect(mockClient.getOrganizationFolder).toHaveBeenCalledTimes(1);
  });
});
