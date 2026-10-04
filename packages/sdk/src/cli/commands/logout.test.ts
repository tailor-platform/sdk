import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { initOAuth2Client } from "#/cli/shared/client";
import {
  loadAccessToken,
  readPlatformConfig,
  saveUserTokens,
  writePlatformConfig,
} from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resetKeyringState } from "#/cli/shared/token-store";
import { logoutCommand } from "./logout";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-logout-${Date.now()}-${Math.random()}`);

const revokeMock = vi.hoisted(() => vi.fn());
const keyringPasswords = vi.hoisted(() => new Map<string, string>());

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    private key: string;
    constructor(service: string, account: string) {
      this.key = `${service}:${account}`;
    }
    setPassword(password: string) {
      keyringPasswords.set(this.key, password);
    }
    getPassword(): string | null {
      return keyringPasswords.get(this.key) ?? null;
    }
    deletePassword() {
      keyringPasswords.delete(this.key);
    }
  },
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOAuth2Client: vi.fn(() => ({
    revoke: revokeMock,
  })),
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";
const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

aroundAll(async (runSuite) => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
  await runSuite();
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("logout --profile", () => {
  aroundEach(async (runTest) => {
    resetKeyringState();
    keyringPasswords.clear();
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
          oauth2_client_id: "dev-client",
        },
      },
      current_user: "u@example.com",
    });
    const config = await readPlatformConfig();
    await saveUserTokens(
      config,
      "u@example.com",
      {
        accessToken: "default-access-token",
        refreshToken: "default-refresh-token",
      },
      futureDate,
    );
    await saveUserTokens(
      config,
      "u@example.com",
      {
        accessToken: "dev-access-token",
        refreshToken: "dev-refresh-token",
      },
      futureDate,
      {
        platformConfig: {
          platformUrl: "https://api.dev.tailor.tech",
          oauth2ClientId: "dev-client",
        },
      },
    );
    config.current_user = "u@example.com";
    writePlatformConfig(config);

    await runTest();

    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("revokes and deletes the token scoped to the selected profile platform", async () => {
    const result = await runCommand(logoutCommand, ["--profile", "dev"]);

    expect(result.success).toBe(true);
    expect(initOAuth2Client).toHaveBeenCalledWith({
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
    });
    expect(revokeMock).toHaveBeenCalledWith(
      {
        accessToken: "dev-access-token",
        refreshToken: "dev-refresh-token",
        expiresAt: Date.parse(futureDate),
      },
      "refresh_token",
    );
    const config = await readPlatformConfig();
    expect(config.current_user).toBe("u@example.com");
    await expect(loadAccessToken()).resolves.toBe("default-access-token");
    await expect(loadAccessToken({ profile: "dev" })).rejects.toThrow(
      'User "u@example.com" not found',
    );
  });

  test("prints the logged-out user and the revocation under JSON output", async () => {
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(logoutCommand, ["--profile", "dev"]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      user: "u@example.com",
      revoked: true,
    });
  });

  test("reports an unrevoked token that was still deleted under JSON output", async () => {
    revokeMock.mockRejectedValueOnce(new Error("revocation endpoint unavailable"));
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(logoutCommand, ["--profile", "dev"]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      user: "u@example.com",
      revoked: false,
    });
  });

  test("reports no change when nobody is logged in under JSON output", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(logoutCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({ changed: false, user: null, revoked: false });
  });

  test("reports clearing a current user that has no stored token under JSON output", async () => {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: {},
      current_user: "stale@example.com",
    });
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(logoutCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      user: "stale@example.com",
      revoked: false,
    });
    const config = await readPlatformConfig();
    expect(config.current_user).toBeNull();
  });

  test("reports no change for a profile user with no stored token under JSON output", async () => {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: { dev: { user: "stale@example.com", workspace_id: validUUID } },
      current_user: "other@example.com",
    });
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(logoutCommand, ["--profile", "dev"]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: false,
      user: "stale@example.com",
      revoked: false,
    });
    const config = await readPlatformConfig();
    expect(config.current_user).toBe("other@example.com");
  });

  test("clears current user when profile logout removes the default token while env selects another platform", async () => {
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "file",
          access_token: "default-access-token",
          refresh_token: "default-refresh-token",
          token_expires_at: futureDate,
        },
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "dev-access-token",
          refresh_token: "dev-refresh-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {
        prod: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.tailor.tech",
        },
      },
      current_user: "u@example.com",
    });

    const result = await runCommand(logoutCommand, ["--profile", "prod"]);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.current_user).toBeNull();
    expect(config.users["u@example.com"]).toBeUndefined();
    expect(config.users["https://api.dev.tailor.tech|u@example.com"]).toBeDefined();
  });

  test("clears current user when profile logout removes the only token for that user", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "dev-access-token",
          refresh_token: "dev-refresh-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
          oauth2_client_id: "dev-client",
        },
      },
      current_user: "u@example.com",
    });

    const result = await runCommand(logoutCommand, ["--profile", "dev"]);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.current_user).toBeNull();
    expect(config.users["https://api.dev.tailor.tech|u@example.com"]).toBeUndefined();
  });

  test("preserves default login when logging out an env-selected platform", async () => {
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "file",
          access_token: "default-access-token",
          refresh_token: "default-refresh-token",
          token_expires_at: futureDate,
        },
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "dev-access-token",
          refresh_token: "dev-refresh-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });

    const result = await runCommand(logoutCommand, []);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.current_user).toBe("u@example.com");
    expect(config.users["u@example.com"]).toBeDefined();
    expect(config.users["https://api.dev.tailor.tech|u@example.com"]).toBeUndefined();

    vi.stubEnv("TAILOR_PLATFORM_URL", undefined);
    await expect(loadAccessToken()).resolves.toBe("default-access-token");
  });

  test("falls back to an env-platform legacy token when logging out without a profile", async () => {
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "file",
          access_token: "legacy-access-token",
          refresh_token: "legacy-refresh-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });

    const result = await runCommand(logoutCommand, []);

    expect(result.success).toBe(true);
    expect(revokeMock).toHaveBeenCalledWith(
      {
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
        expiresAt: Date.parse(futureDate),
      },
      "refresh_token",
    );
    const config = await readPlatformConfig();
    expect(config.current_user).toBeNull();
    expect(config.users["u@example.com"]).toBeUndefined();
  });
});
