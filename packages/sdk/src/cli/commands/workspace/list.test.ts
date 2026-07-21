import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";
import { listWorkspaces } from "./list";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
  loadPlatformClientConfig: vi.fn(),
}));

describe("listWorkspaces", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("uses the selected profile for authentication and Platform selection", async () => {
    const platformConfig = { platformUrl: "https://api.staging.tailor.tech" };
    const client = {
      listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [], nextPageToken: "" }),
    };
    vi.mocked(loadAccessToken).mockResolvedValue("staging-token");
    vi.mocked(loadPlatformClientConfig).mockResolvedValue(platformConfig);
    vi.mocked(initOperatorClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
    );

    await expect(listWorkspaces({ profile: "staging" })).resolves.toEqual([]);
    expect(loadAccessToken).toHaveBeenCalledWith({ profile: "staging" });
    expect(loadPlatformClientConfig).toHaveBeenCalledWith({ profile: "staging" });
    expect(initOperatorClient).toHaveBeenCalledWith("staging-token", platformConfig);
  });

  test("rejects an explicitly empty profile instead of falling back", async () => {
    await expect(listWorkspaces({ profile: "" })).rejects.toThrow("Profile must not be empty");
    expect(loadAccessToken).not.toHaveBeenCalled();
  });
});
