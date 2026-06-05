import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("@/cli/shared/logger", () => ({
  logger: {
    warn: vi.fn<MockProcedure>(),
    info: vi.fn<MockProcedure>(),
  },
}));

describe("checkVaultManaged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns isManaged: true with labels when vault has sdk-name label", async () => {
    const client = {
      getMetadata: vi.fn<MockProcedure>().mockResolvedValue({
        metadata: { labels: { "sdk-name": "my-app", "sdk-version": "v1-0-0", custom: "value" } },
      }),
    } as unknown as OperatorClient;

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(true);
    expect(result.trn).toBe("trn:v1:workspace:ws-1:vault:my-vault");
    expect(result.existingLabels).toEqual({
      "sdk-name": "my-app",
      "sdk-version": "v1-0-0",
      custom: "value",
    });
  });

  test("returns isManaged: false when vault has no sdk-name label", async () => {
    const client = {
      getMetadata: vi.fn<MockProcedure>().mockResolvedValue({
        metadata: { labels: {} },
      }),
    } as unknown as OperatorClient;

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(false);
  });

  test("returns isManaged: false when getMetadata fails", async () => {
    const client = {
      getMetadata: vi.fn<MockProcedure>().mockRejectedValue(new Error("not found")),
    } as unknown as OperatorClient;

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(false);
  });
});

describe("releaseVaultOwnership", () => {
  test("removes sdk-name and sdk-version labels via setMetadata", async () => {
    const client = {
      setMetadata: vi.fn<MockProcedure>().mockResolvedValue({}),
    } as unknown as OperatorClient;

    await releaseVaultOwnership({
      client,
      trn: "trn:v1:workspace:ws-1:vault:my-vault",
      existingLabels: {
        "sdk-name": "my-app",
        "sdk-version": "v1-0-0",
        custom: "value",
      },
    });

    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:v1:workspace:ws-1:vault:my-vault",
      labels: { custom: "value" },
    });
  });

  test("sets empty labels when only sdk labels exist", async () => {
    const client = {
      setMetadata: vi.fn<MockProcedure>().mockResolvedValue({}),
    } as unknown as OperatorClient;

    await releaseVaultOwnership({
      client,
      trn: "trn:v1:workspace:ws-1:vault:my-vault",
      existingLabels: {
        "sdk-name": "my-app",
        "sdk-version": "v1-0-0",
      },
    });

    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:v1:workspace:ws-1:vault:my-vault",
      labels: {},
    });
  });
});
