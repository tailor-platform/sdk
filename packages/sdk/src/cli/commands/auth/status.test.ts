import * as fs from "node:fs";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadAuthStatus, writePlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { statusCommand } from "./status";
import type * as TokenStoreModule from "#/cli/shared/token-store";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-auth-status-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({ xdgConfig: xdgTempDir }));
vi.mock("#/cli/shared/token-store", async (importOriginal) => {
  const actual = await importOriginal<typeof TokenStoreModule>();
  return { ...actual, isKeyringAvailable: vi.fn().mockResolvedValue(false) };
});

const workspaceId = "123e4567-e89b-12d3-a456-426614174000";
const future = "2999-01-01T00:00:00.000Z";
const past = "2000-01-01T00:00:00.000Z";

function writeConfig(options?: { expired?: boolean; refreshable?: boolean; readonly?: boolean }) {
  const userEntry = {
    storage: "file" as const,
    access_token: "secret-access-token",
    ...(options?.refreshable ? { refresh_token: "secret-refresh-token" } : {}),
    token_expires_at: options?.expired ? past : future,
  };
  writePlatformConfig({
    version: 3,
    min_sdk_version: "2.0.0",
    users: {
      alice: userEntry,
      "https://platform.example.com|alice": userEntry,
    },
    profiles: {
      staging: {
        user: "alice",
        workspace_id: workspaceId,
        readonly: options?.readonly,
        platform_url: "https://platform.example.com",
      },
    },
    current_user: "alice",
  });
}

beforeEach(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("auth status", () => {
  test("resolves an environment token without exposing it", async () => {
    writeConfig();
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "environment-secret");

    const status = await loadAuthStatus({ profile: "staging" });

    expect(status).toMatchObject({
      authenticated: true,
      identity: null,
      identitySource: "environment",
      profile: "staging",
      workspaceId,
      permission: "write",
      platformUrl: "https://platform.example.com",
      tokenStatus: "environment",
    });
    expect(JSON.stringify(status)).not.toContain("environment-secret");
  });

  test("resolves an environment token with a missing profile", async () => {
    writeConfig();
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "environment-secret");

    await expect(loadAuthStatus({ profile: "missing" })).resolves.toMatchObject({
      authenticated: true,
      profile: "missing",
      tokenStatus: "environment",
    });
  });

  test("resolves an environment token when the config cannot be read", async () => {
    fs.mkdirSync(`${xdgTempDir}/tailor-platform/config.yaml`, { recursive: true });
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "environment-secret");

    await expect(loadAuthStatus({ profile: "staging" })).resolves.toMatchObject({
      authenticated: true,
      profile: "staging",
      tokenStatus: "environment",
    });
  });

  test("warns when using the deprecated environment token", async () => {
    writeConfig();
    vi.stubEnv("TAILOR_TOKEN", "environment-secret");
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await expect(loadAuthStatus()).resolves.toMatchObject({ tokenStatus: "environment" });
    expect(warnSpy).toHaveBeenCalledWith(
      "TAILOR_TOKEN is deprecated. Please use TAILOR_PLATFORM_TOKEN instead.",
    );
  });

  test.each([
    [undefined, "profile", "valid", true, "write"],
    [{ readonly: true }, "profile", "valid", true, "read"],
    [{ expired: true }, "profile", "expired", false, "write"],
    [{ expired: true, refreshable: true }, "profile", "refreshable", true, "write"],
  ] as const)(
    "reports stored token metadata for %#",
    async (options, identitySource, tokenStatus, authenticated, permission) => {
      writeConfig(options);
      await expect(loadAuthStatus({ profile: "staging" })).resolves.toMatchObject({
        identity: "alice",
        identitySource,
        tokenStatus,
        authenticated,
        permission,
      });
    },
  );

  test("uses the default user without a profile", async () => {
    writeConfig();
    await expect(loadAuthStatus()).resolves.toMatchObject({
      identity: "alice",
      identitySource: "default",
      profile: null,
      workspaceId: null,
      tokenStatus: "valid",
    });
  });

  test("rejects a missing profile", async () => {
    writeConfig();
    await expect(loadAuthStatus({ profile: "missing" })).rejects.toThrow(
      'Profile "missing" not found',
    );
  });

  test("returns a non-zero result for a missing token", async () => {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: { staging: { user: "alice", workspace_id: workspaceId } },
      current_user: null,
    });
    const result = await runCommand(statusCommand, ["--profile", "staging"]);
    expect(result.success).toBe(false);
  });

  test("emits structured JSON without token values", async () => {
    writeConfig({ refreshable: true });
    using _json = jsonMode();
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runCommand(statusCommand, ["--profile", "staging"]);

    expect(result.success).toBe(true);
    const json = output.mock.calls.map(([line]) => String(line)).join("\n");
    expect(JSON.parse(json)).toMatchObject({ identity: "alice", tokenStatus: "valid" });
    expect(json).not.toContain("secret-access-token");
    expect(json).not.toContain("secret-refresh-token");
  });
});
