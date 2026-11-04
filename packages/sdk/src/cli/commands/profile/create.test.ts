import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { writeHeldConfigLock } from "#/cli/shared/test-helpers/config-lock";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "#/cli/shared/token-store";
import { createCommand } from "./create";
import type * as ClientModule from "#/cli/shared/client";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-profile-create-${Date.now()}-${Math.random()}`);
const keyringPasswords = vi.hoisted(() => new Map<string, string>());
const validUUID = "12345678-1234-4abc-8def-123456789012";
const otherUUID = "abcdef12-3456-4abc-8def-abcdef123456";

vi.mock("xdg-basedir", () => ({ xdgConfig: xdgTempDir }));

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

const clientMocks = vi.hoisted(() => ({
  fetchUserInfo: vi.fn(),
  refreshToken: vi.fn(),
  initOperatorClient: vi.fn(),
  fetchAll: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    fetchUserInfo: clientMocks.fetchUserInfo,
    initOperatorClient: clientMocks.initOperatorClient,
    fetchAll: clientMocks.fetchAll,
    initOAuth2Client: () => ({ refreshToken: clientMocks.refreshToken }),
  };
});

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("profile create with a migrating legacy email user", () => {
  beforeEach(() => {
    resetKeyringState();
    keyringPasswords.clear();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("writes the resolved subject as profile.user when the legacy email key migrates", async () => {
    using _logger = silenceLogger("out", "success");

    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    clientMocks.refreshToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: Date.now() + 3600 * 1000,
    });
    clientMocks.fetchUserInfo.mockResolvedValue({
      sub: "platform-user-sub",
      email: "legacy@example.com",
    });
    clientMocks.initOperatorClient.mockResolvedValue({
      listWorkspaces: vi.fn(),
    });
    clientMocks.fetchAll.mockResolvedValue([{ id: validUUID }]);

    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "legacy@example.com": {
          access_token: "expired-access-token",
          refresh_token: "refresh",
          token_expires_at: pastDate,
          storage: "file",
        },
      },
      profiles: {},
      current_user: "legacy@example.com",
    });

    await runCommand(createCommand, [
      "myprofile",
      "--user",
      "legacy@example.com",
      "--workspace-id",
      validUUID,
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.user).toBe("platform-user-sub");
    expect(config.users["platform-user-sub"]).toMatchObject({ storage: "keyring" });
    expect(keyringPasswords.get("tailor-platform-cli:platform-user-sub")).toBe(
      JSON.stringify({ accessToken: "new-access-token", refreshToken: "new-refresh-token" }),
    );
    expect(config.users["legacy@example.com"]).toBeUndefined();
  });
});

describe("profile create while another process updates the config", () => {
  beforeEach(() => {
    resetKeyringState();
    keyringPasswords.clear();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("does not overwrite a profile another process created while the token was refreshed", async () => {
    clientMocks.initOperatorClient.mockClear();
    clientMocks.refreshToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: Date.now() + 3600 * 1000,
    });
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {
        "platform-user-sub": {
          storage: "file",
          access_token: "expired-access-token",
          refresh_token: "refresh",
          token_expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      },
      profiles: {},
      current_user: "platform-user-sub",
    });
    const otherProfile = { user: "platform-user-sub", workspace_id: otherUUID };
    const lockPath = path.join(xdgTempDir, "tailor-platform", "config.yaml.lock");
    writeHeldConfigLock(lockPath);
    setTimeout(() => {
      void (async () => {
        const config = await readPlatformConfig();
        config.profiles.myprofile = otherProfile;
        writePlatformConfig(config);
        fs.rmSync(lockPath);
      })();
    }, 100);

    const result = await runCommand(createCommand, [
      "myprofile",
      "--user",
      "platform-user-sub",
      "--workspace-id",
      validUUID,
    ]);

    expect(result).toMatchObject({ success: false, error: { code: "PROFILE_EXISTS" } });
    expect((await readPlatformConfig()).profiles.myprofile).toEqual(otherProfile);
    expect(clientMocks.initOperatorClient).not.toHaveBeenCalled();
  });
});
