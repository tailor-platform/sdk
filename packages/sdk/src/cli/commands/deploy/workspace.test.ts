import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { isCLIError } from "#/cli/shared/errors";
import { resolveDeployWorkspace } from "./workspace";
import type * as ClientModule from "#/cli/shared/client";
import type * as ContextModule from "#/cli/shared/context";
import type * as CreateWorkspaceModule from "../workspace/create";
import type { WorkspaceInfo } from "../workspace/transform";

const mocks = vi.hoisted(() => ({
  canPrompt: vi.fn(),
  createValidatedWorkspaceWithClient: vi.fn(),
  getPlatformBaseUrl: vi.fn(),
  initOperatorClient: vi.fn(),
  listWorkspacesWithClient: vi.fn(),
  loadAccessToken: vi.fn(),
  loadPlatformClientConfig: vi.fn(),
  loadWorkspaceContext: vi.fn(),
  saveWorkspaceContext: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  tryLoadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  getPlatformBaseUrl: mocks.getPlatformBaseUrl,
  initOperatorClient: mocks.initOperatorClient,
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal<typeof ContextModule>()),
  loadAccessToken: mocks.loadAccessToken,
  loadPlatformClientConfig: mocks.loadPlatformClientConfig,
  tryLoadWorkspaceId: mocks.tryLoadWorkspaceId,
}));

vi.mock("#/cli/shared/prompt", () => ({
  canPrompt: mocks.canPrompt,
  prompt: {
    confirm: mocks.confirm,
    select: mocks.select,
    text: mocks.text,
  },
}));

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: mocks.info,
    success: mocks.success,
    warn: mocks.warn,
  },
}));

vi.mock("../workspace/create", async (importOriginal) => ({
  ...(await importOriginal<typeof CreateWorkspaceModule>()),
  createValidatedWorkspaceWithClient: mocks.createValidatedWorkspaceWithClient,
}));

vi.mock("../workspace/list", () => ({
  listWorkspacesWithClient: mocks.listWorkspacesWithClient,
}));

vi.mock("./workspace-context", () => ({
  loadWorkspaceContext: mocks.loadWorkspaceContext,
  saveWorkspaceContext: mocks.saveWorkspaceContext,
}));

const client = {
  getWorkspace: vi.fn(),
  listAvailableWorkspaceRegions: vi.fn(),
};

const workspace = (id: string, name = "example-workspace", region = "us-west"): WorkspaceInfo => ({
  id,
  name,
  region,
  createdAt: new Date("2026-07-13T00:00:00Z"),
  updatedAt: new Date("2026-07-13T00:00:00Z"),
  organizationId: "33333333-3333-4333-8333-333333333333",
  folderId: "44444444-4444-4444-8444-444444444444",
});

const contextTargets = (...configPaths: string[]) =>
  configPaths.map((configPath) => ({ configPath, applicationId: `app:${configPath}` }));

describe("resolveDeployWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canPrompt.mockReturnValue(false);
    mocks.getPlatformBaseUrl.mockReturnValue("https://api.tailor.tech");
    mocks.initOperatorClient.mockResolvedValue(client);
    mocks.listWorkspacesWithClient.mockResolvedValue([]);
    mocks.loadAccessToken.mockResolvedValue("access-token");
    mocks.loadPlatformClientConfig.mockResolvedValue(undefined);
    mocks.loadWorkspaceContext.mockResolvedValue(undefined);
    mocks.tryLoadWorkspaceId.mockResolvedValue(undefined);
    client.listAvailableWorkspaceRegions.mockResolvedValue({
      regions: ["us-west", "asia-northeast"],
    });
    client.getWorkspace.mockImplementation(async ({ workspaceId }: { workspaceId: string }) => ({
      workspace: {
        id: workspaceId,
        name: "explicit-workspace",
        region: "us-west",
      },
    }));
  });

  test("uses an explicitly configured workspace without discovery", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    mocks.tryLoadWorkspaceId.mockResolvedValue(id);

    await expect(resolveDeployWorkspace({ workspaceId: id })).resolves.toEqual({
      client,
      workspaceId: id,
    });
    expect(mocks.listWorkspacesWithClient).not.toHaveBeenCalled();
    expect(mocks.loadWorkspaceContext).not.toHaveBeenCalled();
    expect(client.getWorkspace).toHaveBeenCalledWith({ workspaceId: id });
    expect(mocks.loadPlatformClientConfig).toHaveBeenCalledWith({
      profile: undefined,
      allowMissingProfile: true,
    });
    expect(mocks.saveWorkspaceContext).toHaveBeenCalledWith({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: id,
    });
  });

  test("does not remember an explicit workspace that cannot be verified", async () => {
    const id = "19191919-1919-4919-8919-191919191919";
    mocks.tryLoadWorkspaceId.mockResolvedValue(id);
    client.getWorkspace.mockRejectedValue(new Error("workspace not found"));

    await expect(resolveDeployWorkspace({ workspaceId: id })).rejects.toThrow(
      "workspace not found",
    );
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("normalizes an explicit workspace NotFound response", async () => {
    const id = "19191919-1919-4919-8919-191919191919";
    mocks.tryLoadWorkspaceId.mockResolvedValue(id);
    client.getWorkspace.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    await expect(resolveDeployWorkspace({ workspaceId: id })).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_NOT_FOUND",
    });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("reuses project workspace context before account discovery", async () => {
    const id = "12121212-1212-4212-8212-121212121212";
    mocks.listWorkspacesWithClient.mockResolvedValue([workspace(id)]);
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: id,
      workspaceName: "example-workspace",
      workspaceRegion: "us-west",
    });

    await expect(resolveDeployWorkspace()).resolves.toEqual({ client, workspaceId: id });
    expect(mocks.listWorkspacesWithClient).toHaveBeenCalledOnce();
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      `Using saved workspace selection: example-workspace (us-west, org: 33333333-3333-4333-8333-333333333333, id: ${id})`,
    );
    expect(mocks.info).not.toHaveBeenCalled();
  });

  test("rejects stale project context before selecting a workspace", async () => {
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "14141414-1414-4414-8414-141414141414",
      workspaceName: "deleted-workspace",
      workspaceRegion: "us-west",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([
      workspace("15151515-1515-4515-8515-151515151515", "first"),
      workspace("16161616-1616-4616-8616-161616161616", "second"),
    ]);

    await expect(resolveDeployWorkspace()).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CONTEXT_STALE",
    });
  });

  test("does not silently relink a stale context to the only visible workspace", async () => {
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "17171717-1717-4717-8717-171717171717",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([
      workspace("18181818-1818-4818-8818-181818181818", "staging"),
    ]);

    await expect(resolveDeployWorkspace()).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CONTEXT_STALE",
    });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("asks before replacing a stale context interactively", async () => {
    const available = workspace("24242424-2424-4424-8424-242424242424", "staging");
    mocks.canPrompt.mockReturnValue(true);
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "25252525-2525-4525-8525-252525252525",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([available]);
    mocks.select.mockResolvedValue(available.id);

    await expect(resolveDeployWorkspace()).resolves.toEqual({
      client,
      workspaceId: available.id,
    });
    expect(mocks.select).toHaveBeenCalledOnce();
  });

  test("does not ignore a requested creation identity while recovering stale context", async () => {
    const available = workspace("24242424-2424-4424-8424-242424242424", "staging");
    mocks.canPrompt.mockReturnValue(true);
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "25252525-2525-4525-8525-252525252525",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([available]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "production",
        workspaceRegion: available.region,
        organizationId: available.organizationId,
        folderId: available.folderId,
      }),
    ).rejects.toMatchObject({ name: "CLIError", code: "WORKSPACE_CREATE_CONFLICT" });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  test("allows explicit ensure to replace a stale context when no workspace remains", async () => {
    const created = workspace("28282828-2828-4828-8828-282828282828", "replacement");
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "29292929-2929-4929-8929-292929292929",
    });
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: created.name,
        workspaceRegion: created.region,
      }),
    ).resolves.toEqual({ client, workspaceId: created.id });
  });

  test("reuses a matching workspace for explicit ensure when project context is stale", async () => {
    const available = workspace("30303030-3030-4030-8030-303030303030", "replacement");
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "31313131-3131-4131-8131-313131313131",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([available]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: available.name,
        workspaceRegion: available.region,
        organizationId: available.organizationId,
        folderId: available.folderId,
      }),
    ).resolves.toEqual({ client, workspaceId: available.id });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
  });

  test("does not let an incomplete ensure silently replace a stale project context", async () => {
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "32323232-3232-4232-8232-323232323232",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([
      workspace("33333333-3333-4333-8333-333333333333", "replacement"),
    ]);

    await expect(resolveDeployWorkspace({ createWorkspace: true })).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CONTEXT_STALE",
    });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("reports missing create options before a stale context when no workspace remains", async () => {
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "32323232-3232-4232-8232-323232323232",
    });

    await expect(
      resolveDeployWorkspace({ createWorkspace: true, workspaceName: "replacement" }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_OPTIONS_REQUIRED",
      context: { missingOptions: ["--workspace-region"] },
    });
  });

  test("does not reuse project context that conflicts with requested creation identity", async () => {
    mocks.loadWorkspaceContext.mockResolvedValue({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "13131313-1313-4313-8313-131313131313",
      workspaceName: "old-workspace",
      workspaceRegion: "us-west",
    });
    mocks.listWorkspacesWithClient.mockResolvedValue([
      workspace("13131313-1313-4313-8313-131313131313", "old-workspace"),
    ]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "new-workspace",
        workspaceRegion: "us-west",
      }),
    ).rejects.toMatchObject({ name: "CLIError", code: "WORKSPACE_CREATE_CONFLICT" });
  });

  test("rejects empty creation identity instead of reusing an existing workspace", async () => {
    const existing = workspace("34343434-3434-4434-8434-343434343434");
    mocks.listWorkspacesWithClient.mockResolvedValue([existing]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "",
        workspaceRegion: existing.region,
      }),
    ).rejects.toMatchObject({ name: "CLIError", code: "WORKSPACE_CREATE_OPTIONS_INVALID" });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("fails non-interactively with a machine-actionable create command", async () => {
    const promise = resolveDeployWorkspace({
      deployArgs: ["deploy", "--config", "/apps/example/tailor.config.ts", "--no-validate"],
    });

    await expect(promise).rejects.toSatisfy((error: unknown) => {
      expect(isCLIError(error)).toBe(true);
      if (!isCLIError(error)) return false;
      expect(error.code).toBe("WORKSPACE_NOT_FOUND");
      expect(error.next).toEqual({
        command: "tailor-sdk",
        args: [
          "deploy",
          "--config",
          "/apps/example/tailor.config.ts",
          "--no-validate",
          "--create-workspace",
          "--workspace-name",
          "<name>",
          "--workspace-region",
          "<region>",
        ],
      });
      expect(error.context).toEqual({ availableRegions: ["us-west", "asia-northeast"] });
      return true;
    });
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
    expect(mocks.text).not.toHaveBeenCalled();
  });

  test("creates a workspace non-interactively when fully specified", async () => {
    const created = workspace("22222222-2222-4222-8222-222222222222");
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
        organizationId: "33333333-3333-4333-8333-333333333333",
        folderId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ client, workspaceId: created.id });
    expect(mocks.createValidatedWorkspaceWithClient).toHaveBeenCalledOnce();
    expect(mocks.createValidatedWorkspaceWithClient).toHaveBeenCalledWith(client, {
      name: "example-workspace",
      region: "us-west",
      organizationId: "33333333-3333-4333-8333-333333333333",
      folderId: "44444444-4444-4444-8444-444444444444",
    });
    expect(mocks.saveWorkspaceContext).toHaveBeenCalledWith({
      version: 1,
      platformUrl: "https://api.tailor.tech",
      workspaceId: created.id,
    });
  });

  test("automatically selects the only workspace", async () => {
    const only = workspace("55555555-5555-4555-8555-555555555555");
    mocks.listWorkspacesWithClient.mockResolvedValue([only]);

    await expect(resolveDeployWorkspace()).resolves.toEqual({
      client,
      workspaceId: only.id,
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.saveWorkspaceContext).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining(only.id));
  });

  test("rejects workspace creation options without --create-workspace", async () => {
    const only = workspace("54545454-5454-4454-8454-545454545454", "production");
    mocks.listWorkspacesWithClient.mockResolvedValue([only]);

    await expect(
      resolveDeployWorkspace({
        workspaceName: "staging",
        workspaceRegion: "us-west",
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_FLAG_REQUIRED",
      next: {
        command: "tailor-sdk",
        args: [
          "deploy",
          "--create-workspace",
          "--workspace-name",
          "staging",
          "--workspace-region",
          "us-west",
        ],
      },
    });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("ignores ambient creation scope when an existing workspace is explicit", async () => {
    const workspaceId = "56565656-5656-4656-8656-565656565656";
    mocks.tryLoadWorkspaceId.mockResolvedValue(workspaceId);

    await expect(
      resolveDeployWorkspace({
        workspaceId,
        organizationId: "57575757-5757-4757-8757-575757575757",
        folderId: "58585858-5858-4858-8858-585858585858",
      }),
    ).resolves.toEqual({ client, workspaceId });
    expect(mocks.listWorkspacesWithClient).not.toHaveBeenCalled();
    expect(client.getWorkspace).toHaveBeenCalledWith({ workspaceId });
  });

  test("does not persist an automatically selected workspace during dry-run", async () => {
    const only = workspace("19191919-1919-4919-8919-191919191919");
    mocks.listWorkspacesWithClient.mockResolvedValue([only]);

    await expect(resolveDeployWorkspace({ dryRun: true })).resolves.toEqual({
      client,
      workspaceId: only.id,
    });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("stores independent context files beside every deployed config", async () => {
    const only = workspace("23232323-2323-4323-8323-232323232323");
    mocks.listWorkspacesWithClient.mockResolvedValue([only]);

    await resolveDeployWorkspace({
      contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/b/tailor.config.ts"),
    });

    expect(mocks.loadWorkspaceContext).toHaveBeenCalledWith(
      "https://api.tailor.tech",
      "/apps/a/tailor.config.ts",
      "app:/apps/a/tailor.config.ts",
    );
    expect(mocks.loadWorkspaceContext).toHaveBeenCalledWith(
      "https://api.tailor.tech",
      "/apps/b/tailor.config.ts",
      "app:/apps/b/tailor.config.ts",
    );
    expect(mocks.saveWorkspaceContext).toHaveBeenCalledWith(
      expect.any(Object),
      "/apps/a/tailor.config.ts",
      "app:/apps/a/tailor.config.ts",
    );
    expect(mocks.saveWorkspaceContext).toHaveBeenCalledWith(
      expect.any(Object),
      "/apps/b/tailor.config.ts",
      "app:/apps/b/tailor.config.ts",
    );
  });

  test("fills in a missing context when only some deployed configs are linked", async () => {
    const only = workspace("23232323-2323-4323-8323-232323232323");
    mocks.listWorkspacesWithClient.mockResolvedValue([only]);
    mocks.loadWorkspaceContext
      .mockResolvedValueOnce({
        version: 1,
        platformUrl: "https://api.tailor.tech",
        workspaceId: only.id,
      })
      .mockResolvedValueOnce(undefined);

    await resolveDeployWorkspace({
      contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/b/tailor.config.ts"),
    });

    expect(mocks.saveWorkspaceContext).toHaveBeenCalledTimes(2);
  });

  test("does not merge configs linked to different workspaces non-interactively", async () => {
    mocks.loadWorkspaceContext
      .mockResolvedValueOnce({
        version: 1,
        platformUrl: "https://api.tailor.tech",
        workspaceId: "26262626-2626-4626-8626-262626262626",
      })
      .mockResolvedValueOnce({
        version: 1,
        platformUrl: "https://api.tailor.tech",
        workspaceId: "27272727-2727-4727-8727-272727272727",
      });

    await expect(
      resolveDeployWorkspace({
        contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/b/tailor.config.ts"),
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CONTEXT_CONFLICT",
    });
  });

  test("replaces conflicting stale contexts when workspace creation is fully specified", async () => {
    const created = workspace("35353535-3535-4535-8535-353535353535", "replacement");
    mocks.loadWorkspaceContext
      .mockResolvedValueOnce({
        version: 1,
        platformUrl: "https://api.tailor.tech",
        workspaceId: "36363636-3636-4636-8636-363636363636",
      })
      .mockResolvedValueOnce({
        version: 1,
        platformUrl: "https://api.tailor.tech",
        workspaceId: "37373737-3737-4737-8737-373737373737",
      });
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: created.name,
        workspaceRegion: created.region,
        contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/b/tailor.config.ts"),
      }),
    ).resolves.toEqual({ client, workspaceId: created.id });
  });

  test("prompts to select when multiple workspaces exist", async () => {
    const first = workspace("66666666-6666-4666-8666-666666666666", "first");
    const second = workspace("77777777-7777-4777-8777-777777777777", "second");
    mocks.canPrompt.mockReturnValue(true);
    mocks.listWorkspacesWithClient.mockResolvedValue([first, second]);
    mocks.select.mockResolvedValue(second.id);

    await expect(resolveDeployWorkspace()).resolves.toEqual({
      client,
      workspaceId: second.id,
    });
    expect(mocks.select).toHaveBeenCalledWith({
      message: "Select a workspace",
      choices: [
        {
          name: `first (us-west, org: ${first.organizationId}, id: ${first.id})`,
          value: first.id,
        },
        {
          name: `second (us-west, org: ${second.organizationId}, id: ${second.id})`,
          value: second.id,
        },
        {
          name: "Create new workspace",
          value: "create-new-workspace",
        },
      ],
    });
  });

  test.each([
    ["one", [workspace("40404040-4040-4040-8040-404040404040", "only")]],
    [
      "multiple",
      [
        workspace("41414141-4141-4141-8141-414141414141", "first"),
        workspace("42424242-4242-4242-8242-424242424242", "second"),
      ],
    ],
  ])("offers workspace creation when %s workspace is available", async (_, workspaces) => {
    const created = workspace("43434343-4343-4343-8343-434343434343", "new-workspace");
    mocks.canPrompt.mockReturnValue(true);
    mocks.listWorkspacesWithClient.mockResolvedValue(workspaces);
    mocks.select.mockImplementation(async ({ message }: { message: string }) =>
      message === "Select a workspace" ? "create-new-workspace" : created.region,
    );
    mocks.text.mockResolvedValue(created.name);
    mocks.confirm.mockResolvedValue(true);
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);

    await expect(resolveDeployWorkspace()).resolves.toEqual({
      client,
      workspaceId: created.id,
    });
    expect(mocks.select).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "Select a workspace",
        choices: expect.arrayContaining([
          { name: "Create new workspace", value: "create-new-workspace" },
        ]),
      }),
    );
    expect(mocks.createValidatedWorkspaceWithClient).toHaveBeenCalledOnce();
  });

  test("does not guess among multiple workspaces non-interactively", async () => {
    mocks.listWorkspacesWithClient.mockResolvedValue([
      workspace("88888888-8888-4888-8888-888888888888", "first"),
      workspace("99999999-9999-4999-8999-999999999999", "second"),
    ]);

    await expect(resolveDeployWorkspace({ createWorkspace: true })).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_SELECTION_REQUIRED",
      next: {
        command: "tailor-sdk",
        args: ["deploy", "--workspace-id", "<workspace-id>"],
      },
    });
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
  });

  test("guides interactive workspace creation", async () => {
    const created = workspace("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "new-workspace");
    mocks.canPrompt.mockReturnValue(true);
    mocks.text.mockResolvedValue("new-workspace");
    mocks.select.mockResolvedValue("asia-northeast");
    mocks.confirm.mockResolvedValue(true);
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);

    await expect(resolveDeployWorkspace()).resolves.toEqual({
      client,
      workspaceId: created.id,
    });
    expect(mocks.text).toHaveBeenCalledWith({
      message: "Workspace name",
      default: expect.any(String),
      validate: expect.any(Function),
    });
    expect(mocks.select).toHaveBeenCalledWith({
      message: "Workspace region",
      choices: [
        { name: "us-west", value: "us-west" },
        { name: "asia-northeast", value: "asia-northeast" },
      ],
    });
    expect(mocks.confirm).toHaveBeenCalledWith({
      message: 'Create workspace "new-workspace" in asia-northeast?',
      default: true,
    });
    expect(mocks.info).toHaveBeenCalledWith(
      `Reuse this workspace with: tailor-sdk deploy --workspace-id ${created.id}`,
    );
    expect(mocks.info).toHaveBeenCalledWith(`Or set TAILOR_PLATFORM_WORKSPACE_ID=${created.id}.`);
  });

  test("rejects an explicitly empty partial creation identity with a stable error", async () => {
    mocks.canPrompt.mockReturnValue(true);

    await expect(
      resolveDeployWorkspace({ createWorkspace: true, workspaceName: "" }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_OPTIONS_INVALID",
    });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  test("shows the organization and folder in workspace creation confirmation", async () => {
    const created = workspace("abababab-abab-4bab-8bab-abababababab", "new-workspace");
    mocks.canPrompt.mockReturnValue(true);
    mocks.confirm.mockResolvedValue(true);
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);

    await resolveDeployWorkspace({
      createWorkspace: true,
      workspaceName: created.name,
      workspaceRegion: created.region,
      organizationId: created.organizationId,
      folderId: created.folderId,
    });

    expect(mocks.confirm).toHaveBeenCalledWith({
      message: `Create workspace "${created.name}" in ${created.region} (organization: ${created.organizationId}, folder: ${created.folderId})?`,
      default: true,
    });
  });

  test("requires all creation arguments in non-interactive mode", async () => {
    await expect(
      resolveDeployWorkspace({ createWorkspace: true, workspaceName: "example-workspace" }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_OPTIONS_REQUIRED",
      context: { missingOptions: ["--workspace-region"] },
    });
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
  });

  test("never creates a workspace during dry-run", async () => {
    mocks.canPrompt.mockReturnValue(true);

    await expect(
      resolveDeployWorkspace({
        dryRun: true,
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATION_DISABLED_IN_DRY_RUN",
    });
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("rejects invalid creation options before the create RPC", async () => {
    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
        organizationId: "not-a-uuid",
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_OPTIONS_INVALID",
    });
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
  });

  test("rejects an invalid region before resolving an existing workspace", async () => {
    mocks.listWorkspacesWithClient.mockResolvedValue([
      workspace("56565656-5656-4656-8656-565656565656"),
    ]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "not-a-region",
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_OPTIONS_INVALID",
    });
    expect(mocks.saveWorkspaceContext).not.toHaveBeenCalled();
  });

  test("rejects invalid creation options before asking for confirmation", async () => {
    mocks.canPrompt.mockReturnValue(true);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "Invalid_Name",
        workspaceRegion: "not-a-region",
      }),
    ).rejects.toMatchObject({ name: "CLIError", code: "WORKSPACE_CREATE_OPTIONS_INVALID" });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  test("reuses a matching workspace on a retry", async () => {
    const existing = workspace("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    mocks.listWorkspacesWithClient.mockResolvedValue([existing]);
    client.listAvailableWorkspaceRegions.mockRejectedValue(new Error("region API unavailable"));

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
        organizationId: existing.organizationId,
        folderId: existing.folderId,
      }),
    ).resolves.toEqual({ client, workspaceId: existing.id });
    expect(mocks.createValidatedWorkspaceWithClient).not.toHaveBeenCalled();
    expect(client.listAvailableWorkspaceRegions).not.toHaveBeenCalled();
  });

  test("does not reuse a workspace from another requested organization", async () => {
    const existing = workspace("20202020-2020-4020-8020-202020202020");
    mocks.listWorkspacesWithClient.mockResolvedValue([existing]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: existing.name,
        workspaceRegion: existing.region,
        organizationId: "21212121-2121-4121-8121-212121212121",
        workspaceCommandArgs: ["--env-file", "/apps/example/.env.staging"],
        workspaceCommandJson: true,
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATE_CONFLICT",
      next: {
        command: "tailor-sdk",
        args: [
          "workspace",
          "create",
          "--env-file",
          "/apps/example/.env.staging",
          "--json",
          "--name",
          existing.name,
          "--region",
          existing.region,
          "--organization-id",
          "21212121-2121-4121-8121-212121212121",
        ],
      },
    });
  });

  test("does not reuse an organization workspace for a personal creation request", async () => {
    const existing = workspace("57575757-5757-4757-8757-575757575757");
    mocks.listWorkspacesWithClient.mockResolvedValue([existing]);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: existing.name,
        workspaceRegion: existing.region,
      }),
    ).rejects.toMatchObject({ name: "CLIError", code: "WORKSPACE_CREATE_CONFLICT" });
  });

  test("continues with the created workspace when project context cannot be saved", async () => {
    const created = workspace("22222222-3333-4333-8333-222222222222");
    mocks.createValidatedWorkspaceWithClient.mockResolvedValue(created);
    mocks.saveWorkspaceContext.mockRejectedValue(new Error("read-only filesystem"));

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: created.name,
        workspaceRegion: created.region,
      }),
    ).resolves.toEqual({ client, workspaceId: created.id });
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining(created.id));
  });

  test("stops when a multi-config workspace selection is only partially saved", async () => {
    const available = workspace("f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2");
    mocks.listWorkspacesWithClient.mockResolvedValue([available]);
    mocks.saveWorkspaceContext
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("read-only filesystem"));

    await expect(
      resolveDeployWorkspace({
        contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/b/tailor.config.ts"),
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CONTEXT_SAVE_FAILED",
    });
  });

  test("continues an explicit multi-config deployment when context saving is partial", async () => {
    const id = "38383838-3838-4838-8838-383838383838";
    mocks.tryLoadWorkspaceId.mockResolvedValue(id);
    mocks.saveWorkspaceContext
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("read-only filesystem"));

    await expect(
      resolveDeployWorkspace({
        workspaceId: id,
        contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/b/tailor.config.ts"),
      }),
    ).resolves.toEqual({ client, workspaceId: id });
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining(id));
  });

  test("treats duplicate config paths as one context save target", async () => {
    const available = workspace("39393939-3939-4939-8939-393939393939");
    mocks.listWorkspacesWithClient.mockResolvedValue([available]);
    mocks.saveWorkspaceContext.mockRejectedValue(new Error("read-only filesystem"));

    await expect(
      resolveDeployWorkspace({
        contextTargets: contextTargets("/apps/a/tailor.config.ts", "/apps/a/tailor.config.ts"),
      }),
    ).resolves.toEqual({ client, workspaceId: available.id });
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining(available.id));
  });

  test("surfaces an ambiguous creation failure without retrying", async () => {
    mocks.createValidatedWorkspaceWithClient.mockRejectedValue(new Error("connection reset"));

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
        workspaceCommandArgs: ["--env-file", "/apps/example/.env.staging"],
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      code: "WORKSPACE_CREATION_FAILED",
      next: {
        command: "tailor-sdk",
        args: ["workspace", "list", "--env-file", "/apps/example/.env.staging", "--json"],
      },
    });
    expect(mocks.createValidatedWorkspaceWithClient).toHaveBeenCalledOnce();
  });

  test("preserves definitive Connect RPC creation errors", async () => {
    const error = new ConnectError("permission denied", Code.PermissionDenied);
    mocks.createValidatedWorkspaceWithClient.mockRejectedValue(error);

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
      }),
    ).rejects.toBe(error);
  });

  test("does not remove option values that resemble the JSON flag", async () => {
    mocks.createValidatedWorkspaceWithClient.mockRejectedValue(new Error("connection reset"));

    await expect(
      resolveDeployWorkspace({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
        workspaceCommandArgs: ["--profile=--json"],
        workspaceCommandJson: true,
      }),
    ).rejects.toMatchObject({
      next: {
        command: "tailor-sdk",
        args: ["workspace", "list", "--profile=--json", "--json"],
      },
    });
  });
});
