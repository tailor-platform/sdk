import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { silenceLogger } from "@/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "@/cli/shared/token-store";
import { createCommand } from "./create";
import type * as ClientModule from "@/cli/shared/client";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-profile-create-${Date.now()}-${Math.random()}`);
const validUUID = "12345678-1234-4abc-8def-123456789012";

vi.mock("xdg-basedir", () => ({ xdgConfig: xdgTempDir }));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    setPassword() {}
    getPassword(): string | null {
      return null;
    }
    deletePassword() {}
  },
}));

const clientMocks = vi.hoisted(() => ({
  fetchUserInfo: vi.fn(),
  refreshToken: vi.fn(),
  initOperatorClient: vi.fn(),
  fetchAll: vi.fn(),
}));

vi.mock("@/cli/shared/client", async (importOriginal) => {
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
    vi.clearAllMocks();
    resetKeyringState();
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
    expect(config.users["platform-user-sub"]).toMatchObject({ storage: "file" });
    expect(config.users["legacy@example.com"]).toBeUndefined();
  });
});
