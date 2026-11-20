import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import {
  mockOperatorClient,
  type OperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
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
    getMetadata: OperatorClientMocks<"getMetadata">["getMetadata"],
  ): Awaited<ReturnType<typeof initOperatorClient>> {
    const client = mockOperatorClient({
      getWorkspace: {
        workspace: { id: workspaceId, name: "ws", region: "us-west", organizationId: "org-1" },
      },
      getMetadata,
    });
    vi.mocked(initOperatorClient).mockResolvedValue(client);
    return client;
  }

  test("reports the recorded expiry", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    stubClient({
      metadata: { labels: { [expiresAtLabelKey]: encodeExpiresAt(expiresAt) } },
    });

    await expect(getWorkspace({ workspaceId })).resolves.toMatchObject({
      expiresAt: expiresAt.toISOString(),
    });
  });

  test("reports no expiry as null, not as unavailable", async () => {
    stubClient({ metadata: { labels: {} } });

    await expect(getWorkspace({ workspaceId })).resolves.toMatchObject({ expiresAt: null });
  });

  test("reports a failed read as unavailable rather than as no expiry", async () => {
    stubClient(() => Promise.reject(new Error("permission denied")));

    await expect(getWorkspace({ workspaceId })).resolves.toMatchObject({
      expiresAt: "unavailable",
    });
  });
});
