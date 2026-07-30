import { aroundEach, describe, expect, test, vi } from "vitest";
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";
import type { OperatorClient } from "#/cli/shared/client";

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const TRN = "trn:v1:workspace:ws-1:vault:my-vault";

const clientWithMetadata = (metadata: unknown) =>
  ({ getMetadata: vi.fn().mockResolvedValue({ metadata }) }) as unknown as OperatorClient;

describe("checkVaultManaged", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("returns isManaged: true with labels when vault has sdk-name label", async () => {
    const client = clientWithMetadata({
      labels: { "sdk-name": "my-app", "sdk-version": "v1-0-0", custom: "value" },
    });

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(true);
    expect(result.trn).toBe(TRN);
    expect(result.existingLabels).toEqual({
      "sdk-name": "my-app",
      "sdk-version": "v1-0-0",
      custom: "value",
    });
  });

  test("returns isManaged: false when vault has no sdk-name label", async () => {
    const client = clientWithMetadata({ labels: {} });

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(false);
  });

  test("returns isManaged: false when getMetadata fails", async () => {
    const client = {
      getMetadata: vi.fn().mockRejectedValue(new Error("not found")),
    } as unknown as OperatorClient;

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(false);
  });
});

describe("releaseVaultOwnership", () => {
  test.each([
    [
      "removes sdk-name and sdk-version labels via setMetadata",
      { "sdk-name": "my-app", "sdk-version": "v1-0-0", custom: "value" },
      { custom: "value" },
    ],
    [
      "sets empty labels when only sdk labels exist",
      { "sdk-name": "my-app", "sdk-version": "v1-0-0" },
      {},
    ],
  ])("%s", async (_name, remoteLabels, expectedLabels) => {
    const client = {
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: remoteLabels } }),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    await releaseVaultOwnership({ client, trn: TRN });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: TRN, labels: expectedLabels });
  });

  test("keeps a label written after checkVaultManaged read the metadata", async () => {
    const client = {
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-name": "my-app", "sdk-version": "v1-0-0", added: "later" } },
      }),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    await releaseVaultOwnership({ client, trn: TRN });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: TRN, labels: { added: "later" } });
  });
});
