import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { encodeExpiresAt, expiresAtLabelKey } from "./expiry";
import { getWorkspace } from "./get";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

const workspaceId = "12345678-1234-4abc-8def-123456789012";

describe("getWorkspace", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("token");
    vi.mocked(loadWorkspaceId).mockResolvedValue(workspaceId);
    await runTest();
  });

  function stubClient(
    getMetadata: ReturnType<typeof vi.fn>,
  ): Awaited<ReturnType<typeof initOperatorClient>> {
    const client = {
      getWorkspace: vi.fn().mockResolvedValue({
        workspace: { id: workspaceId, name: "ws", region: "us-west" },
      }),
      getMetadata,
    };
    vi.mocked(initOperatorClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    return client as unknown as Awaited<ReturnType<typeof initOperatorClient>>;
  }

  test("reports the recorded expiry", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    stubClient(
      vi.fn().mockResolvedValue({
        metadata: { labels: { [expiresAtLabelKey]: encodeExpiresAt(expiresAt) } },
      }),
    );

    await expect(getWorkspace({ workspaceId })).resolves.toMatchObject({
      expiresAt: expiresAt.toISOString(),
    });
  });

  test("reports no expiry as null, not as unavailable", async () => {
    stubClient(vi.fn().mockResolvedValue({ metadata: { labels: {} } }));

    await expect(getWorkspace({ workspaceId })).resolves.toMatchObject({ expiresAt: null });
  });

  test("reports a failed read as unavailable rather than as no expiry", async () => {
    stubClient(vi.fn().mockRejectedValue(new Error("permission denied")));

    await expect(getWorkspace({ workspaceId })).resolves.toMatchObject({
      expiresAt: "unavailable",
    });
  });
});
