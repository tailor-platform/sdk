import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeExpiresAt, expiresAtLabelKey } from "../src/cli/commands/workspace/expiry";
import { initOperatorClient } from "../src/cli/shared/client";
import { loadAccessToken, loadUserWorkspaceDefaults } from "../src/cli/shared/context";
import {
  mockOperatorClient,
  type OperatorClientMocks,
} from "../src/cli/shared/test-helpers/operator-client";
import { resolveE2EWorkspaceLocation, trackWorkspace } from "./globalSetup";

vi.mock("../src/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/shared/context")>()),
  loadUserWorkspaceDefaults: vi.fn(),
  loadAccessToken: vi.fn(),
}));

vi.mock("../src/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/shared/client")>()),
  initOperatorClient: vi.fn(),
}));

const workspaceId = "00000000-0000-4000-8000-000000000001";
const trackingFile = path.join(os.tmpdir(), "e2e-workspaces", workspaceId);

function fakeClient(setMetadata: OperatorClientMocks<"setMetadata">["setMetadata"]) {
  return mockOperatorClient({
    getMetadata: { metadata: { labels: {} } },
    setMetadata,
    deleteWorkspace: {},
  });
}

describe("trackWorkspace", () => {
  afterEach(() => {
    fs.rmSync(trackingFile, { force: true });
  });

  test("records an expiry 24 hours after the workspace is tracked", async () => {
    const client = fakeClient(async () => ({}));
    const before = Date.now();

    await trackWorkspace(client, workspaceId);

    const labels = client.setMetadata.mock.calls[0]?.[0].labels;
    const expiresAt = decodeExpiresAt(labels?.[expiresAtLabelKey])?.getTime() ?? 0;
    const day = 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + day - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + day);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("deletes the workspace and rethrows when the expiry cannot be recorded", async () => {
    const client = fakeClient(async () => {
      throw new Error("metadata unavailable");
    });

    await expect(trackWorkspace(client, workspaceId)).rejects.toThrow("metadata unavailable");

    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId });
    expect(fs.existsSync(trackingFile)).toBe(false);
  });

  test("rethrows the expiry error even when the cleanup delete fails too", async () => {
    const client = fakeClient(async () => {
      throw new Error("metadata unavailable");
    });
    client.deleteWorkspace.mockRejectedValue(new Error("delete denied"));

    await expect(trackWorkspace(client, workspaceId)).rejects.toThrow("metadata unavailable");
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

describe("teardown", () => {
  let tmpRoot: string;
  let trackingDir: string;
  const client = mockOperatorClient({ deleteWorkspace: {} });

  async function loadTeardown() {
    vi.resetModules();
    return (await import("./globalSetup")).teardown;
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-teardown-test-"));
    trackingDir = path.join(tmpRoot, "e2e-workspaces");
    vi.stubEnv("TMPDIR", tmpRoot);
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    client.deleteWorkspace.mockReset().mockResolvedValue({});
    vi.mocked(loadAccessToken).mockReset().mockResolvedValue("profile-token");
    vi.mocked(initOperatorClient).mockReset().mockResolvedValue(client);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function track(...ids: string[]) {
    fs.mkdirSync(trackingDir, { recursive: true });
    for (const id of ids) fs.writeFileSync(path.join(trackingDir, id), "");
  }

  test("deletes tracked workspaces even without the token environment variable", async () => {
    track("ws-a", "ws-b");
    const teardown = await loadTeardown();

    await teardown();

    expect(client.deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId: "ws-a" });
    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId: "ws-b" });
  });

  test("does not authenticate when no workspace is tracked", async () => {
    const teardown = await loadTeardown();

    await teardown();

    expect(loadAccessToken).not.toHaveBeenCalled();
  });

  test("warns instead of throwing when authentication cannot be resolved", async () => {
    track("ws-a");
    vi.mocked(loadAccessToken).mockRejectedValue(new Error("Tailor Platform token not found."));
    const teardown = await loadTeardown();

    await expect(teardown()).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("authentication unavailable"),
      expect.any(Error),
    );
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });
});
