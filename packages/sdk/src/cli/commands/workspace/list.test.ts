import { describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";
import { encodeExpiresAt, expiresAtLabelKey } from "./expiry";
import { listWorkspaces, listWorkspacesWithExpiry } from "./list";

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

describe("listWorkspacesWithExpiry", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("token");
    vi.mocked(loadPlatformClientConfig).mockResolvedValue({});
    await runTest();
  });

  function stubClient(labelsByTrn: Record<string, Record<string, string>>) {
    const client = {
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [
          { id: "ws-expiring", name: "expiring", region: "us-west" },
          { id: "ws-bare", name: "bare", region: "us-west" },
          { id: "ws-broken", name: "broken", region: "us-west" },
          { id: "ws-unreadable", name: "unreadable", region: "us-west" },
        ],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        if (trn === "trn:v1:workspace:ws-unreadable") {
          return Promise.reject(new Error("permission denied"));
        }
        return Promise.resolve({ metadata: { labels: labelsByTrn[trn] ?? {} } });
      }),
    };
    vi.mocked(initOperatorClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    return client;
  }

  test("distinguishes a recorded expiry from none, an unwritable value, and a failed read", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    stubClient({
      "trn:v1:workspace:ws-expiring": { [expiresAtLabelKey]: encodeExpiresAt(expiresAt) },
      "trn:v1:workspace:ws-broken": { [expiresAtLabelKey]: "not-an-expiry" },
    });

    const workspaces = await listWorkspacesWithExpiry();

    expect(workspaces.map(({ name, expiresAt: reported }) => [name, reported])).toEqual([
      ["expiring", expiresAt.toISOString()],
      ["bare", null],
      ["broken", "invalid"],
      ["unreadable", "unavailable"],
    ]);
  });
});
