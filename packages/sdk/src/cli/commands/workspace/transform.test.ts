import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#src/cli/shared/logger";
import {
  workspaceDetailsWithFolderName,
  workspaceDisplayName,
  workspaceInfosWithFolderNames,
  workspaceInfoWithFolderName,
  workspaceNameTransformer,
} from "./transform";
import type { OperatorClient } from "#src/cli/shared/client";
import type { Workspace } from "@tailor-platform/tailor-proto/workspace_resource_pb";

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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test("adds folderName and renders the display name as folder/workspace", async () => {
    const info = await workspaceInfoWithFolderName(client(), workspace());

    expect(info).toMatchObject({
      name: "sample-space",
      folderName: "dev",
    });
    expect(workspaceDisplayName(info)).toBe("dev/sample-space");
  });

  test("omits folderName when the workspace has no folder", async () => {
    const mockClient = client();
    const info = await workspaceInfoWithFolderName(
      mockClient,
      workspace({ organizationId: "", folderId: "" }),
    );

    expect(info).not.toHaveProperty("folderName");
    expect(workspaceDisplayName(info)).toBe("sample-space");
    expect(mockClient.getOrganizationFolder).not.toHaveBeenCalled();
  });

  test("omits folderName when the folder lookup is unavailable to the user", async () => {
    const mockClient = {
      getOrganizationFolder: vi
        .fn()
        .mockRejectedValue(new ConnectError("permission denied", Code.PermissionDenied)),
    } as unknown as OperatorClient;
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const info = await workspaceInfoWithFolderName(mockClient, workspace());

    expect(info).not.toHaveProperty("folderName");
    expect(workspaceDisplayName(info)).toBe("sample-space");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("warns and omits folderName when folder lookup fails unexpectedly", async () => {
    const mockClient = {
      getOrganizationFolder: vi
        .fn()
        .mockRejectedValue(new ConnectError("service unavailable", Code.Unavailable)),
    } as unknown as OperatorClient;
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const info = await workspaceInfoWithFolderName(mockClient, workspace());

    expect(info).not.toHaveProperty("folderName");
    expect(workspaceDisplayName(info)).toBe("sample-space");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to resolve workspace folder name:"),
    );
  });

  test("adds folderName to workspace details", async () => {
    const details = await workspaceDetailsWithFolderName(client("prod"), workspace());

    expect(details).toMatchObject({
      name: "sample-space",
      folderName: "prod",
      organizationId: "organization-1",
      folderId: "folder-1",
    });
  });

  test("falls back to the raw field value when folderName is not a string", () => {
    expect(workspaceNameTransformer("raw-space", { name: "sample-space" })).toBe("raw-space");
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

  test("caps concurrent folder lookups with a fixed limit", async () => {
    vi.useFakeTimers();
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "2");
    let active = 0;
    let maxActive = 0;
    const mockClient = {
      getOrganizationFolder: vi.fn().mockImplementation(async ({ folderId }) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return { folder: { name: folderId } };
      }),
    } as unknown as OperatorClient;

    const pending = workspaceInfosWithFolderNames(
      mockClient,
      Array.from({ length: 7 }, (_, index) =>
        workspace({
          id: `workspace-${index}`,
          name: `space-${index}`,
          folderId: `folder-${index}`,
        }),
      ),
    );
    await vi.runAllTimersAsync();
    const infos = await pending;

    expect(maxActive).toBe(5);
    expect(infos.map(workspaceDisplayName)).toEqual([
      "folder-0/space-0",
      "folder-1/space-1",
      "folder-2/space-2",
      "folder-3/space-3",
      "folder-4/space-4",
      "folder-5/space-5",
      "folder-6/space-6",
    ]);
  });
});
