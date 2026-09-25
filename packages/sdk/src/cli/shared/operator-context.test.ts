import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "./operator-context";

const mocks = vi.hoisted(() => ({
  initOperatorClient: vi.fn(),
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("./client", () => ({
  initOperatorClient: mocks.initOperatorClient,
}));

vi.mock("./context", () => ({
  loadAccessToken: mocks.loadAccessToken,
  loadWorkspaceId: mocks.loadWorkspaceId,
}));

describe("loadOperatorWorkspaceContext", () => {
  test("loads the token, client, and workspace in order", async () => {
    const client = { getWorkspace: vi.fn() };
    mocks.loadAccessToken.mockResolvedValue("access-token");
    mocks.initOperatorClient.mockResolvedValue(client);
    mocks.loadWorkspaceId.mockResolvedValue("workspace-id");

    await expect(
      loadOperatorWorkspaceContext({
        profile: "development",
        workspaceId: "requested-workspace-id",
      }),
    ).resolves.toEqual({ client, workspaceId: "workspace-id" });

    expect(mocks.loadAccessToken).toHaveBeenCalledWith({ profile: "development" });
    expect(mocks.initOperatorClient).toHaveBeenCalledWith("access-token");
    expect(mocks.loadWorkspaceId).toHaveBeenCalledWith({
      profile: "development",
      workspaceId: "requested-workspace-id",
    });
    expect(mocks.loadAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initOperatorClient.mock.invocationCallOrder[0]!,
    );
    expect(mocks.initOperatorClient.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadWorkspaceId.mock.invocationCallOrder[0]!,
    );
  });
});
