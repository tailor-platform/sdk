import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { initOAuth2Client } from "#/cli/shared/client";
import {
  loadAccessToken,
  readPlatformConfig,
  saveUserTokens,
  writePlatformConfig,
} from "#/cli/shared/context";
import { resetKeyringState } from "#/cli/shared/token-store";
import { logoutCommand } from "./logout";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-logout-${Date.now()}-${Math.random()}`);

const revokeMock = vi.hoisted(() => vi.fn());

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
  initOAuth2Client: vi.fn(() => ({
    revoke: revokeMock,
  })),
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";
const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("logout --profile", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetKeyringState();
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
      { platformUrl: "https://api.dev.tailor.tech", oauth2ClientId: "dev-client" },
    );
    config.current_user = "u@example.com";
    writePlatformConfig(config);
  });

  afterEach(() => {
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

  test("cleans local state when keyring credentials are missing", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "keyring",
          token_expires_at: futureDate,
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });

    const result = await runCommand(logoutCommand, []);

    expect(result.success).toBe(true);
    expect(revokeMock).not.toHaveBeenCalled();
    const config = await readPlatformConfig();
    expect(config.current_user).toBeNull();
    expect(config.users["u@example.com"]).toBeUndefined();
  });
});
