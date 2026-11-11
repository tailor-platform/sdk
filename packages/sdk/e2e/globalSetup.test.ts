import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeExpiresAt, expiresAtLabelKey } from "../src/cli/commands/workspace/expiry";
import { loadUserWorkspaceDefaults } from "../src/cli/shared/context";
import { resolveE2EWorkspaceLocation, trackWorkspace } from "./globalSetup";
import type { OperatorClient } from "../src/cli/shared/client";

vi.mock("../src/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/shared/context")>()),
  loadUserWorkspaceDefaults: vi.fn(),
}));

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

describe("resolveE2EWorkspaceLocation", () => {
  const userDefaults = { organizationId: "default-org", folderId: "default-folder" };

  beforeEach(() => {
    vi.mocked(loadUserWorkspaceDefaults).mockResolvedValue(userDefaults);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(loadUserWorkspaceDefaults).mockReset();
  });

  test("uses the organization and folder from the environment when both are set", async () => {
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", "env-org");
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", "env-folder");

    await expect(resolveE2EWorkspaceLocation()).resolves.toEqual({
      organizationId: "env-org",
      folderId: "env-folder",
    });
    expect(loadUserWorkspaceDefaults).not.toHaveBeenCalled();
  });

  test("does not mix in the user's default folder when only the organization is set", async () => {
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", "env-org");
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", "");

    await expect(resolveE2EWorkspaceLocation()).resolves.toEqual({
      organizationId: "env-org",
      folderId: undefined,
    });
  });

  test("treats empty environment variables as not set", async () => {
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", "");
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", "");

    await expect(resolveE2EWorkspaceLocation()).resolves.toEqual(userDefaults);
  });

  test("falls back to the user's default organization and folder without environment variables", async () => {
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", undefined);
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", undefined);

    await expect(resolveE2EWorkspaceLocation()).resolves.toEqual(userDefaults);
  });

  test("returns no location when neither the environment nor the user provides one", async () => {
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", undefined);
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", undefined);
    vi.mocked(loadUserWorkspaceDefaults).mockResolvedValue(undefined);

    await expect(resolveE2EWorkspaceLocation()).resolves.toEqual({
      organizationId: undefined,
      folderId: undefined,
    });
  });
});
