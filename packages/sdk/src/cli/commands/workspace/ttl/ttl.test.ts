import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { writePlatformConfig } from "#/cli/shared/context";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "#/cli/shared/token-store";
import { decodeExpiresAt, expiresAtLabelKey } from "../expiry";
import { clearCommand } from "./clear";
import { setCommand } from "./set";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-workspace-ttl-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    setPassword() {}
    getPassword(): string | null {
      return null;
    }
    deletePassword() {}
  },
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

const workspaceId = "12345678-1234-4abc-8def-123456789012";
const workspaceTrn = `trn:v1:workspace:${workspaceId}`;

function seedConfig() {
  writePlatformConfig({
    version: 2,
    min_sdk_version: "1.29.0",
    users: {
      "u@example.com": {
        storage: "file",
        token_expires_at: "2099-12-31T00:00:00Z",
        access_token: "mock-token",
        refresh_token: undefined,
      },
    },
    profiles: {},
    current_user: "u@example.com",
  });
}

function stubClient(labels: Record<string, string> = {}) {
  const client = {
    getMetadata: vi.fn().mockResolvedValue({ metadata: { labels } }),
    setMetadata: vi.fn().mockResolvedValue({}),
  };
  vi.mocked(initOperatorClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  return client;
}

aroundAll(async (runSuite) => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
  await runSuite();
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("workspace ttl", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "mock-token");
    seedConfig();
    await runTest();
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  describe("set", () => {
    test("records an expiry measured from now, not from the workspace's creation", async () => {
      const client = stubClient();
      using _logger = silenceLogger("success");
      const before = Date.now();

      const result = await runCommand(setCommand, ["--workspace-id", workspaceId, "--ttl", "24h"]);

      expect(result.success).toBe(true);
      const written = client.setMetadata.mock.calls[0]?.[0] as {
        trn: string;
        labels: Record<string, string>;
      };
      expect(written.trn).toBe(workspaceTrn);
      const expiresAt = decodeExpiresAt(written.labels[expiresAtLabelKey]);
      expect(expiresAt).toBeDefined();
      // Truncated to whole seconds, so allow the second the write straddled.
      expect(expiresAt?.getTime()).toBeGreaterThanOrEqual(before + 86_400_000 - 1000);
      expect(expiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    });

    test("replaces an existing expiry while keeping the workspace's other labels", async () => {
      const client = stubClient({ "sdk-name": "keep-me", [expiresAtLabelKey]: "s-1" });
      using _logger = silenceLogger("success");

      await runCommand(setCommand, ["--workspace-id", workspaceId, "--ttl", "1h"]);

      const written = client.setMetadata.mock.calls[0]?.[0] as { labels: Record<string, string> };
      expect(written.labels["sdk-name"]).toBe("keep-me");
      expect(written.labels[expiresAtLabelKey]).not.toBe("s-1");
    });

    test("recovers a workspace whose recorded value this CLI could not have written", async () => {
      const client = stubClient({ [expiresAtLabelKey]: "not-an-expiry" });
      using _logger = silenceLogger("success");

      const result = await runCommand(setCommand, ["--workspace-id", workspaceId, "--ttl", "1h"]);

      expect(result.success).toBe(true);
      const written = client.setMetadata.mock.calls[0]?.[0] as { labels: Record<string, string> };
      expect(decodeExpiresAt(written.labels[expiresAtLabelKey])).toBeDefined();
    });

    test("rejects a duration it cannot parse before calling the platform", async () => {
      const client = stubClient();
      using _logger = silenceLogger("success", "error");

      const result = await runCommand(setCommand, ["--workspace-id", workspaceId, "--ttl", "24"]);

      expect(result.success).toBe(false);
      expect(client.setMetadata).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    test("removes the expiry key rather than blanking it, keeping other labels", async () => {
      const client = stubClient({ "sdk-name": "keep-me", [expiresAtLabelKey]: "s-1" });
      using _logger = silenceLogger("success");

      const result = await runCommand(clearCommand, ["--workspace-id", workspaceId]);

      expect(result.success).toBe(true);
      const written = client.setMetadata.mock.calls[0]?.[0] as { labels: Record<string, string> };
      expect(written).toBeDefined();
      expect(expiresAtLabelKey in written.labels).toBe(false);
      expect(written.labels["sdk-name"]).toBe("keep-me");
    });

    test("succeeds without writing when the workspace records no expiry", async () => {
      const client = stubClient({ "sdk-name": "keep-me" });
      using _logger = silenceLogger("success");

      const result = await runCommand(clearCommand, ["--workspace-id", workspaceId]);

      expect(result.success).toBe(true);
      expect(client.setMetadata).not.toHaveBeenCalled();
    });
  });
});
