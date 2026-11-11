import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  deploy: vi.fn(),
  show: vi.fn(),
  getMachineUserToken: vi.fn(),
}));

vi.mock("@tailor-platform/sdk/cli", () => sdk);

const loadGlobalSetup = async () => {
  vi.resetModules();
  return import("../templates/workflow/e2e/globalSetup");
};

const project = () => ({ provide: vi.fn() });

describe("workflow template e2e globalSetup", () => {
  beforeEach(() => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_NAME", "e2e-ws");
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_REGION", "asia-northeast");
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", "");
    vi.stubEnv("TAILOR_CI_ALLOW_ID_INJECTION", "");
    sdk.createWorkspace.mockResolvedValue({ id: "ws-1", name: "e2e-ws", ttl: { state: "set" } });
    sdk.deleteWorkspace.mockResolvedValue(undefined);
    sdk.deploy.mockResolvedValue(undefined);
    sdk.show.mockResolvedValue({ url: "https://app.example" });
    sdk.getMachineUserToken.mockResolvedValue({ accessToken: "token" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("deletes the created workspace exactly once and throws the deploy error when deploy fails", async () => {
    const deployError = new Error("deploy failed");
    sdk.deploy.mockRejectedValue(deployError);
    const { setup, teardown } = await loadGlobalSetup();

    await expect(setup(project() as never)).rejects.toBe(deployError);
    await teardown();

    expect(sdk.deleteWorkspace).toHaveBeenCalledTimes(1);
    expect(sdk.deleteWorkspace).toHaveBeenCalledWith({ workspaceId: "ws-1" });
  });

  test("deletes the created workspace when a step after deploy fails", async () => {
    const tokenError = new Error("token failed");
    sdk.getMachineUserToken.mockRejectedValue(tokenError);
    const { setup } = await loadGlobalSetup();

    await expect(setup(project() as never)).rejects.toBe(tokenError);

    expect(sdk.deleteWorkspace).toHaveBeenCalledTimes(1);
  });

  test("keeps the deploy error and warns when deleting the workspace also fails", async () => {
    const deployError = new Error("deploy failed");
    const deleteError = new Error("delete failed");
    sdk.deploy.mockRejectedValue(deployError);
    sdk.deleteWorkspace.mockRejectedValue(deleteError);
    const { setup } = await loadGlobalSetup();

    await expect(setup(project() as never)).rejects.toBe(deployError);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ws-1"), deleteError);
  });

  test("teardown deletes the workspace once after a successful run", async () => {
    const { setup, teardown } = await loadGlobalSetup();

    await setup(project() as never);
    expect(sdk.deleteWorkspace).not.toHaveBeenCalled();
    await teardown();
    await teardown();

    expect(sdk.deleteWorkspace).toHaveBeenCalledTimes(1);
  });

  test("teardown warns instead of throwing when deleting the workspace fails", async () => {
    const deleteError = new Error("delete failed");
    sdk.deleteWorkspace.mockRejectedValue(deleteError);
    const { setup, teardown } = await loadGlobalSetup();
    await setup(project() as never);

    await expect(teardown()).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ws-1"), deleteError);
  });
});
