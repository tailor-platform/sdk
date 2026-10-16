import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { decodeExpiresAt, expiresAtLabelKey } from "../src/cli/commands/workspace/expiry";
import { trackWorkspace } from "./globalSetup";
import type { OperatorClient } from "../src/cli/shared/client";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const trackingFile = path.join(os.tmpdir(), "e2e-workspaces", workspaceId);

type SetMetadata = (request: { trn: string; labels: Record<string, string> }) => Promise<unknown>;

function fakeClient(setMetadata: SetMetadata) {
  const client = {
    getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
    setMetadata: vi.fn(setMetadata),
    deleteWorkspace: vi.fn().mockResolvedValue({}),
  };
  return { client, asOperator: client as unknown as OperatorClient };
}

describe("trackWorkspace", () => {
  afterEach(() => {
    fs.rmSync(trackingFile, { force: true });
  });

  test("records an expiry 24 hours after the workspace is tracked", async () => {
    const { client, asOperator } = fakeClient(async () => ({}));
    const before = Date.now();

    await trackWorkspace(asOperator, workspaceId);

    const labels = client.setMetadata.mock.calls[0]?.[0].labels;
    const expiresAt = decodeExpiresAt(labels?.[expiresAtLabelKey])?.getTime() ?? 0;
    const day = 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + day - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + day);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("deletes the workspace and rethrows when the expiry cannot be recorded", async () => {
    const { client, asOperator } = fakeClient(async () => {
      throw new Error("metadata unavailable");
    });

    await expect(trackWorkspace(asOperator, workspaceId)).rejects.toThrow("metadata unavailable");

    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId });
    expect(fs.existsSync(trackingFile)).toBe(false);
  });

  test("rethrows the expiry error even when the cleanup delete fails too", async () => {
    const { client, asOperator } = fakeClient(async () => {
      throw new Error("metadata unavailable");
    });
    client.deleteWorkspace.mockRejectedValue(new Error("delete denied"));

    await expect(trackWorkspace(asOperator, workspaceId)).rejects.toThrow("metadata unavailable");
  });
});
