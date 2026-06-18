import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetchMachineUserToken, initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadMachineUserName, loadWorkspaceId } from "#/cli/shared/context";
import { getMachineUserToken } from "./token";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
  loadMachineUserName: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
  fetchMachineUserToken: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

describe("getMachineUserToken", () => {
  let getAuthMachineUserMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
      },
    } as Awaited<ReturnType<typeof loadConfig>>);

    getAuthMachineUserMock = vi.fn().mockResolvedValue({
      machineUser: { clientId: "client-id", clientSecret: "client-secret" },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getApplication: vi.fn().mockResolvedValue({
        application: { authNamespace: "auth-ns", url: "https://app.example.com" },
      }),
      getAuthMachineUser: getAuthMachineUserMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(fetchMachineUserToken).mockResolvedValue({
      token_type: "Bearer",
      access_token: "machine-token",
      expires_in: 3600,
    });
  });

  test("forwards the name option to machine user resolution", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("flag-bot");

    await getMachineUserToken({ name: "flag-bot" });

    expect(loadMachineUserName).toHaveBeenCalledWith({
      machineUser: "flag-bot",
      profile: undefined,
    });
    expect(getAuthMachineUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "flag-bot" }),
    );
  });

  test("uses machine user from profile default when name is absent", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("profile-bot");

    const token = await getMachineUserToken({});

    expect(getAuthMachineUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "profile-bot" }),
    );
    expect(token.accessToken).toBe("machine-token");
  });

  test("throws when no machine user source is available", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);

    await expect(getMachineUserToken({})).rejects.toThrow("Machine user is required");
    expect(vi.mocked(initOperatorClient)).not.toHaveBeenCalled();
  });
});
