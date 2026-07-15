import { describe, test, expect, vi, beforeEach } from "vitest";
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
  beforeEach(() => {
    vi.clearAllMocks();
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
  ])("%s", async (_name, existingLabels, expectedLabels) => {
    const client = { setMetadata: vi.fn().mockResolvedValue({}) } as unknown as OperatorClient;

    await releaseVaultOwnership({ client, trn: TRN, existingLabels });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: TRN, labels: expectedLabels });
  });
});
