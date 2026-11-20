import { describe, expect, test, vi } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { MetadataSchema } from "@tailor-platform/tailor-proto/metadata_resource_pb";

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const TRN = "trn:v1:workspace:ws-1:vault:my-vault";

const clientWithMetadata = (metadata: MessageInitShape<typeof MetadataSchema>) =>
  mockOperatorClient({ getMetadata: { metadata } });

describe("checkVaultManaged", () => {
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

  test("returns isManaged: true when a workspace config manages the vault", async () => {
    const client = clientWithMetadata({
      labels: { "sdk-managed": "workspace", "sdk-version": "v1-0-0" },
    });

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(true);
  });

  test("returns isManaged: false when vault has no sdk-name label", async () => {
    const client = clientWithMetadata({ labels: {} });

    const result = await checkVaultManaged({ client, workspaceId: "ws-1", vaultName: "my-vault" });

    expect(result.isManaged).toBe(false);
  });

  test("returns isManaged: false when getMetadata fails", async () => {
    const client = mockOperatorClient({
      getMetadata: () => Promise.reject(new Error("not found")),
    });

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
    [
      // Ownership is decided by sdk-app-id alone, so a vault that kept it would
      // still be deleted by the next deploy of a config that dropped it.
      "removes sdk-app-id, which decides ownership on its own",
      { "sdk-name": "my-app", "sdk-version": "v1-0-0", "sdk-app-id": "app-uuid", custom: "value" },
      { custom: "value" },
    ],
    [
      "removes the workspace mark, which decides ownership on its own",
      { "sdk-managed": "workspace", "sdk-version": "v1-0-0", custom: "value" },
      { custom: "value" },
    ],
  ])("%s", async (_name, remoteLabels, expectedLabels) => {
    const client = mockOperatorClient({
      getMetadata: { metadata: { labels: remoteLabels } },
      setMetadata: {},
    });

    await releaseVaultOwnership({ client, trn: TRN });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: TRN, labels: expectedLabels });
  });

  test("keeps a label written after checkVaultManaged read the metadata", async () => {
    const client = mockOperatorClient({
      getMetadata: {
        metadata: { labels: { "sdk-name": "my-app", "sdk-version": "v1-0-0", added: "later" } },
      },
      setMetadata: {},
    });

    await releaseVaultOwnership({ client, trn: TRN });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: TRN, labels: { added: "later" } });
  });
});
