import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML } from "confbox";
import * as path from "pathe";
import { describe, expect, test, vi, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import {
  loadConsoleBaseUrl,
  loadAccessToken,
  loadConfigPath,
  loadMachineUserName,
  loadWorkspaceId,
  platformConfigFromProfile,
  readPlatformConfig,
  saveUserTokens,
  writePlatformConfig,
} from "./context";
import { isCLIError } from "./errors";
import { logger } from "./logger";
import { resetKeyringState } from "./token-store";
import type * as ClientModule from "./client";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-xdg-${Date.now()}-${Math.random()}`);
const refreshTokenMock = vi.hoisted(() => vi.fn());

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

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    initOAuth2Client: vi.fn(() => ({
      refreshToken: refreshTokenMock,
    })),
  };
});

function writeFuturePlatformConfig() {
  const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    "version: 999\nmin_sdk_version: 999.0.0\nusers: {}\nprofiles: {}\ncurrent_user: null\n",
  );
}

type PfProfile = {
  user: string;
  workspace_id: string;
  readonly?: boolean;
  machine_user?: string;
  machine_user_override?: "allow" | "deny";
};

type PfUserV2 =
  | { storage: "keyring"; token_expires_at: string }
  | { storage: "file"; access_token: string; refresh_token?: string; token_expires_at: string };

type PfConfig = {
  version: 2;
  min_sdk_version: `${number}.${number}.${number}`;
  users: Record<string, PfUserV2>;
  profiles: Record<string, PfProfile>;
  current_user: string | null;
};

function v2Config(overrides: Partial<PfConfig> = {}): PfConfig {
  return {
    version: 2,
    min_sdk_version: "1.29.0",
    users: {},
    profiles: {},
    current_user: null,
    ...overrides,
  };
}

function fileUser(accessToken: string, tokenExpiresAt: string): PfUserV2 {
  return {
    access_token: accessToken,
    refresh_token: "refresh",
    token_expires_at: tokenExpiresAt,
    storage: "file",
  };
}

function profile(user: string, overrides: Partial<PfProfile> = {}): PfProfile {
  return { user, workspace_id: "12345678-1234-4abc-8def-123456789012", ...overrides };
}

describe("loadConfigPath", () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns explicit config path when provided", () => {
    const result = loadConfigPath("/explicit/path/config.ts");
    expect(result).toBe("/explicit/path/config.ts");
  });

  test("returns env config path when set", () => {
    process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH = "/env/path/config.ts";
    const result = loadConfigPath();
    expect(result).toBe("/env/path/config.ts");
  });

  test("finds config in current directory", () => {
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  test.each([
    ["parent", ["nested"]],
    ["grandparent", ["nested", "deep"]],
  ])("finds config in %s directory", (_label, segments) => {
    const nestedDir = path.join(tempDir, ...segments);
    fs.mkdirSync(nestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(nestedDir);
    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  test("prefers config in closer directory", () => {
    const nestedDir = path.join(tempDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const parentConfig = path.join(tempDir, "tailor.config.ts");
    const nestedConfig = path.join(nestedDir, "tailor.config.ts");
    fs.writeFileSync(parentConfig, "export default {}");
    fs.writeFileSync(nestedConfig, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(nestedDir);
    const result = loadConfigPath();
    expect(result).toBe(nestedConfig);
  });

  test("returns undefined when config not found", () => {
    const result = loadConfigPath();
    expect(result).toBeUndefined();
  });
});

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

describe("loadWorkspaceId", () => {
  const originalEnv = process.env;
  const validUUID = "12345678-1234-4abc-8def-123456789012";
  const otherUUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const invalidUUID = "not-a-uuid";

  beforeEach(() => {
    vi.resetModules();
    refreshTokenMock.mockReset();
    resetKeyringState();
    process.env = { ...originalEnv };
    delete process.env.TAILOR_PLATFORM_WORKSPACE_ID;
    delete process.env.TAILOR_PLATFORM_PROFILE;
    writePlatformConfig(v2Config());
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("opts.workspaceId", () => {
    test("returns workspaceId from options when provided", async () => {
      const result = await loadWorkspaceId({ workspaceId: validUUID });
      expect(result).toBe(validUUID);
    });

    test("opts.workspaceId takes precedence over an unreadable env profile config", async () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writeFuturePlatformConfig();

      const result = await loadWorkspaceId({ workspaceId: validUUID });

      expect(result).toBe(validUUID);
    });

    test("throws error when opts.workspaceId is invalid UUID", async () => {
      await expect(loadWorkspaceId({ workspaceId: invalidUUID })).rejects.toThrow(
        "Invalid value from --workspace-id option: must be a valid UUID",
      );
    });

    test("opts.workspaceId takes precedence over env variable", async () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = otherUUID;
      const result = await loadWorkspaceId({ workspaceId: validUUID });
      expect(result).toBe(validUUID);
    });
  });

  describe("env.TAILOR_PLATFORM_WORKSPACE_ID", () => {
    test("returns workspaceId from env when opts not provided", async () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = validUUID;
      const result = await loadWorkspaceId();
      expect(result).toBe(validUUID);
    });

    test("throws error when env workspaceId is invalid UUID", async () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = invalidUUID;
      await expect(loadWorkspaceId()).rejects.toThrow(
        "Invalid value from TAILOR_PLATFORM_WORKSPACE_ID environment variable: must be a valid UUID",
      );
    });

    test("env takes precedence over profile", async () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = validUUID;
      writePlatformConfig(
        v2Config({ profiles: { myprofile: profile("test", { workspace_id: otherUUID }) } }),
      );
      const result = await loadWorkspaceId({ profile: "myprofile" });
      expect(result).toBe(validUUID);
    });

    test("env workspace ID takes precedence over an unreadable env profile config", async () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = validUUID;
      writeFuturePlatformConfig();

      const result = await loadWorkspaceId();

      expect(result).toBe(validUUID);
    });
  });

  describe("opts.profile", () => {
    test("returns workspaceId from profile when opts.profile provided", async () => {
      writePlatformConfig(
        v2Config({ profiles: { myprofile: profile("testuser", { workspace_id: validUUID }) } }),
      );
      const result = await loadWorkspaceId({ profile: "myprofile" });
      expect(result).toBe(validUUID);
    });

    test("throws error when profile not found", async () => {
      await expect(loadWorkspaceId({ profile: "nonexistent" })).rejects.toThrow(
        'Profile "nonexistent" not found',
      );
    });

    test("throws error when profile workspace_id is invalid UUID", async () => {
      writePlatformConfig(
        v2Config({ profiles: { badprofile: profile("testuser", { workspace_id: invalidUUID }) } }),
      );
      await expect(loadWorkspaceId({ profile: "badprofile" })).rejects.toThrow(
        'Invalid value from profile "badprofile": must be a valid UUID',
      );
    });
  });

  describe("env.TAILOR_PLATFORM_PROFILE", () => {
    test("returns workspaceId from env profile when set", async () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writePlatformConfig(
        v2Config({ profiles: { envprofile: profile("testuser", { workspace_id: validUUID }) } }),
      );
      const result = await loadWorkspaceId();
      expect(result).toBe(validUUID);
    });

    test("opts.profile takes precedence over env profile", async () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writePlatformConfig(
        v2Config({
          profiles: {
            envprofile: profile("testuser", { workspace_id: otherUUID }),
            optsprofile: profile("testuser", { workspace_id: validUUID }),
          },
        }),
      );
      const result = await loadWorkspaceId({ profile: "optsprofile" });
      expect(result).toBe(validUUID);
    });
  });

  describe("error case: no workspace ID source", () => {
    test("throws error when no workspaceId source is available", async () => {
      await expect(loadWorkspaceId()).rejects.toThrow("Workspace ID not found");
    });
  });
});

describe("loadMachineUserName", () => {
  const validUUID = "12345678-1234-4abc-8def-123456789012";

  beforeEach(() => {
    vi.resetModules();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    writePlatformConfig(v2Config());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns machineUser from opts when provided", async () => {
    const result = await loadMachineUserName({ machineUser: "bot" });
    expect(result).toBe("bot");
  });

  test("opts.machineUser takes precedence over env variable", async () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "env-bot");
    const result = await loadMachineUserName({ machineUser: "opts-bot" });
    expect(result).toBe("opts-bot");
  });

  test("returns machineUser from env when opts not provided", async () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "env-bot");
    const result = await loadMachineUserName();
    expect(result).toBe("env-bot");
  });

  test("env takes precedence over profile default", async () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "env-bot");
    writePlatformConfig(
      v2Config({
        profiles: {
          myprofile: profile("u", { workspace_id: validUUID, machine_user: "profile-bot" }),
        },
      }),
    );
    const result = await loadMachineUserName({ profile: "myprofile" });
    expect(result).toBe("env-bot");
  });

  test("returns machine_user from profile when profile provided", async () => {
    writePlatformConfig(
      v2Config({
        profiles: {
          myprofile: profile("u", { workspace_id: validUUID, machine_user: "profile-bot" }),
        },
      }),
    );
    const result = await loadMachineUserName({ profile: "myprofile" });
    expect(result).toBe("profile-bot");
  });

  test("returns undefined when profile has no machine_user", async () => {
    writePlatformConfig(
      v2Config({ profiles: { myprofile: profile("u", { workspace_id: validUUID }) } }),
    );
    const result = await loadMachineUserName({ profile: "myprofile" });
    expect(result).toBeUndefined();
  });

  test("throws when profile does not exist", async () => {
    await expect(loadMachineUserName({ profile: "nonexistent" })).rejects.toThrow(
      'Profile "nonexistent" not found',
    );
  });

  test("returns undefined when nothing is set", async () => {
    const result = await loadMachineUserName();
    expect(result).toBeUndefined();
  });

  test("returns machine_user from env profile when TAILOR_PLATFORM_PROFILE is set", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "envprofile");
    writePlatformConfig(
      v2Config({
        profiles: {
          envprofile: profile("u", { workspace_id: validUUID, machine_user: "env-profile-bot" }),
        },
      }),
    );
    const result = await loadMachineUserName();
    expect(result).toBe("env-profile-bot");
  });

  describe("machine_user_override: deny", () => {
    const envOverrideDetails =
      'The machine user is being set to "other-bot" via the TAILOR_PLATFORM_MACHINE_USER_NAME environment variable, which conflicts with this profile\'s pinned machine user "profile-bot".';

    beforeEach(() => {
      writePlatformConfig(
        v2Config({
          profiles: {
            locked: profile("u", {
              workspace_id: validUUID,
              machine_user: "profile-bot",
              machine_user_override: "deny",
            }),
          },
        }),
      );
    });

    test("rejects with PROFILE_MACHINE_USER_OVERRIDE_DENIED when opts.machineUser differs", async () => {
      const err = await loadMachineUserName({
        machineUser: "other-bot",
        profile: "locked",
      }).catch((e: unknown) => e);
      expect(isCLIError(err)).toBe(true);
      expect((err as { code?: string }).code).toBe("PROFILE_MACHINE_USER_OVERRIDE_DENIED");
    });

    test("rejects with PROFILE_MACHINE_USER_OVERRIDE_DENIED when env var differs", async () => {
      vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "other-bot");
      const err = await loadMachineUserName({ profile: "locked" }).catch((e: unknown) => e);
      expect(isCLIError(err)).toBe(true);
      expect((err as { code?: string }).code).toBe("PROFILE_MACHINE_USER_OVERRIDE_DENIED");
      expect((err as { details?: string }).details).toBe(envOverrideDetails);
    });

    test("reports env var source when the env fallback is passed as opts.machineUser", async () => {
      vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "other-bot");
      const err = await loadMachineUserName({
        machineUser: "other-bot",
        machineUserSource: "env",
        profile: "locked",
      }).catch((e: unknown) => e);
      expect(isCLIError(err)).toBe(true);
      expect((err as { code?: string }).code).toBe("PROFILE_MACHINE_USER_OVERRIDE_DENIED");
      expect((err as { details?: string }).details).toBe(envOverrideDetails);
    });

    test("does not report env var source when opts.machineUser matches env without env source", async () => {
      vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "other-bot");
      const err = await loadMachineUserName({
        machineUser: "other-bot",
        profile: "locked",
      }).catch((e: unknown) => e);
      expect(isCLIError(err)).toBe(true);
      expect((err as { code?: string }).code).toBe("PROFILE_MACHINE_USER_OVERRIDE_DENIED");
      expect((err as { details?: string }).details).toBe(
        'This profile fixes the machine user to "profile-bot" for application-data commands.',
      );
    });

    test("resolves when opts.machineUser matches profile's machine_user", async () => {
      const result = await loadMachineUserName({ machineUser: "profile-bot", profile: "locked" });
      expect(result).toBe("profile-bot");
    });

    test("resolves when env var matches profile's machine_user", async () => {
      vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "profile-bot");
      const result = await loadMachineUserName({ profile: "locked" });
      expect(result).toBe("profile-bot");
    });

    test("resolves to profile's machine_user when nothing explicit is provided", async () => {
      const result = await loadMachineUserName({ profile: "locked" });
      expect(result).toBe("profile-bot");
    });
  });

  test("explicit value wins over profile when profile has machine_user but no override (regression guard)", async () => {
    writePlatformConfig(
      v2Config({
        profiles: {
          myprofile: profile("u", { workspace_id: validUUID, machine_user: "profile-bot" }),
        },
      }),
    );
    const result = await loadMachineUserName({ machineUser: "explicit-bot", profile: "myprofile" });
    expect(result).toBe("explicit-bot");
  });

  test("explicit value returned when profile in scope does not exist", async () => {
    const result = await loadMachineUserName({ machineUser: "explicit-bot", profile: "missing" });
    expect(result).toBe("explicit-bot");
  });

  test("rejects with MACHINE_USER_NAME_EMPTY when opts.machineUser is an empty string", async () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "env-bot");
    const err = await loadMachineUserName({ machineUser: "" }).catch((e: unknown) => e);
    expect(isCLIError(err)).toBe(true);
    expect((err as { code?: string }).code).toBe("MACHINE_USER_NAME_EMPTY");
  });

  test("rejects empty opts.machineUser instead of falling back to profile default", async () => {
    writePlatformConfig(
      v2Config({
        profiles: {
          myprofile: profile("u", { workspace_id: validUUID, machine_user: "profile-bot" }),
        },
      }),
    );
    const err = await loadMachineUserName({ machineUser: "", profile: "myprofile" }).catch(
      (e: unknown) => e,
    );
    expect(isCLIError(err)).toBe(true);
    expect((err as { code?: string }).code).toBe("MACHINE_USER_NAME_EMPTY");
  });
});

describe("loadAccessToken", () => {
  const validToken = "valid-access-token";
  const otherToken = "other-access-token";
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

  beforeEach(() => {
    vi.resetModules();
    resetKeyringState();
    // Explicitly stub env vars to undefined instead of using vi.unstubAllEnvs().
    // unstubAllEnvs() restores to original values, not undefined, so if these
    // vars are set in the real environment, they would leak into tests.
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_TOKEN", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_URL", undefined);
    vi.stubEnv("TAILOR_PLATFORM_OAUTH2_CLIENT_ID", undefined);
    writePlatformConfig(v2Config());
  });

  describe("env.TAILOR_PLATFORM_TOKEN", () => {
    test("returns token from TAILOR_PLATFORM_TOKEN when set", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    test("returns token from TAILOR_PLATFORM_TOKEN before reading an unreadable env profile config", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      vi.stubEnv("TAILOR_PLATFORM_PROFILE", "envprofile");
      writeFuturePlatformConfig();

      const result = await loadAccessToken();

      expect(result).toBe(validToken);
    });

    test("TAILOR_PLATFORM_TOKEN takes precedence over TAILOR_TOKEN", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      vi.stubEnv("TAILOR_TOKEN", otherToken);
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    test("TAILOR_PLATFORM_TOKEN takes precedence over profile", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      writePlatformConfig(
        v2Config({
          users: { testuser: fileUser(otherToken, futureDate) },
          profiles: { myprofile: profile("testuser") },
        }),
      );
      const result = await loadAccessToken({ profile: "myprofile" });
      expect(result).toBe(validToken);
    });
  });

  describe("env.TAILOR_TOKEN (deprecated)", () => {
    test("returns token from TAILOR_TOKEN when TAILOR_PLATFORM_TOKEN not set", async () => {
      vi.stubEnv("TAILOR_TOKEN", validToken);
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
      expect(warnSpy).toHaveBeenCalledWith(
        "TAILOR_TOKEN is deprecated. Please use TAILOR_PLATFORM_TOKEN instead.",
      );
    });
  });

  describe("opts.profile", () => {
    test("returns token from profile when profile provided", async () => {
      writePlatformConfig(
        v2Config({
          users: { testuser: fileUser(validToken, futureDate) },
          profiles: { myprofile: profile("testuser") },
        }),
      );
      const result = await loadAccessToken({ profile: "myprofile" });
      expect(result).toBe(validToken);
    });

    test("throws error when profile not found", async () => {
      await expect(loadAccessToken({ profile: "nonexistent" })).rejects.toThrow(
        'Profile "nonexistent" not found',
      );
    });

    test("prefers the profile user over current_user", async () => {
      writePlatformConfig(
        v2Config({
          users: {
            currentuser: fileUser(validToken, futureDate),
            profileuser: fileUser(otherToken, futureDate),
          },
          profiles: { myprofile: profile("profileuser") },
          current_user: "currentuser",
        }),
      );
      const result = await loadAccessToken({ profile: "myprofile" });
      expect(result).toBe(otherToken);
    });

    test("returns the token saved for the profile platform URL", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: {
          dev: {
            user: "testuser",
            workspace_id: "12345678-1234-4abc-8def-123456789012",
            platform_url: "https://api.dev.tailor.tech",
          },
        },
        current_user: null,
      });
      const config = await readPlatformConfig();
      await saveUserTokens(
        config,
        "testuser",
        {
          accessToken: validToken,
          refreshToken: "refresh",
        },
        futureDate,
        { platformUrl: "https://api.dev.tailor.tech" },
      );
      writePlatformConfig(config);

      const result = await loadAccessToken({ profile: "dev" });

      expect(result).toBe(validToken);
    });

    test("falls back to a legacy user token for a profile platform URL without persisting it", async () => {
      vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          testuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
        },
        profiles: {
          dev: {
            user: "testuser",
            workspace_id: "12345678-1234-4abc-8def-123456789012",
            platform_url: "https://api.dev.tailor.tech",
          },
        },
        current_user: null,
      });

      const result = await loadAccessToken({ profile: "dev" });

      expect(result).toBe(validToken);
      const updatedConfig = await readPlatformConfig();
      expect(updatedConfig.users["https://api.dev.tailor.tech|testuser"]).toBeUndefined();
    });

    test("does not fall back to an unscoped token for a profile platform URL without matching env", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          testuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
        },
        profiles: {
          dev: {
            user: "testuser",
            workspace_id: "12345678-1234-4abc-8def-123456789012",
            platform_url: "https://api.dev.tailor.tech",
          },
        },
        current_user: null,
      });

      await expect(loadAccessToken({ profile: "dev" })).rejects.toThrow(
        'User "testuser" not found',
      );
    });

    test("removes a legacy unscoped token after refreshing it into a scoped platform key", async () => {
      vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const refreshedExpiresAt = Date.now() + 3600 * 1000;
      refreshTokenMock.mockResolvedValueOnce({
        accessToken: "refreshed-token",
        refreshToken: "refreshed-refresh",
        expiresAt: refreshedExpiresAt,
      });
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          testuser: {
            access_token: "legacy-token",
            refresh_token: "legacy-refresh",
            token_expires_at: pastDate,
            storage: "file",
          },
        },
        profiles: {},
        current_user: "testuser",
      });

      const result = await loadAccessToken();

      expect(result).toBe("refreshed-token");
      const updatedConfig = await readPlatformConfig();
      expect(updatedConfig.users.testuser).toBeUndefined();
      expect(updatedConfig.users["https://api.dev.tailor.tech|testuser"]).toMatchObject({
        storage: "file",
        access_token: "refreshed-token",
        refresh_token: "refreshed-refresh",
        token_expires_at: new Date(refreshedExpiresAt).toISOString(),
      });
    });
  });

  describe("env.TAILOR_PLATFORM_PROFILE", () => {
    test("returns token from env profile", async () => {
      vi.stubEnv("TAILOR_PLATFORM_PROFILE", "envprofile");
      writePlatformConfig(
        v2Config({
          users: { testuser: fileUser(validToken, futureDate) },
          profiles: { envprofile: profile("testuser") },
        }),
      );
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    test("opts.profile takes precedence over env profile", async () => {
      vi.stubEnv("TAILOR_PLATFORM_PROFILE", "envprofile");
      writePlatformConfig(
        v2Config({
          users: {
            envuser: fileUser(otherToken, futureDate),
            optsuser: fileUser(validToken, futureDate),
          },
          profiles: {
            envprofile: profile("envuser"),
            optsprofile: profile("optsuser"),
          },
        }),
      );
      const result = await loadAccessToken({ profile: "optsprofile" });
      expect(result).toBe(validToken);
    });
  });

  describe("config.current_user", () => {
    test("returns token from current_user when no env or profile", async () => {
      writePlatformConfig(
        v2Config({
          users: { currentuser: fileUser(validToken, futureDate) },
          current_user: "currentuser",
        }),
      );
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });
  });

  describe("error case: no token source", () => {
    test("throws error when no token source is available", async () => {
      await expect(loadAccessToken()).rejects.toThrow("Tailor Platform token not found");
    });
  });
});

describe("loadConsoleBaseUrl", () => {
  beforeEach(() => {
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_URL", undefined);
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns console_url from the selected profile", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
          console_url: "https://console.dev.tailor.tech",
        },
      },
      current_user: null,
    });

    await expect(loadConsoleBaseUrl({ profile: "dev" })).resolves.toBe(
      "https://console.dev.tailor.tech",
    );
  });

  test("falls back to the default console URL when missing profiles are allowed and config is unreadable", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "missing");
    writeFuturePlatformConfig();

    await expect(loadConsoleBaseUrl({ allowMissingProfile: true })).resolves.toBe(
      "https://console.tailor.tech",
    );
  });
});

describe("platformConfigFromProfile", () => {
  test("returns undefined when the profile has no platform settings", () => {
    expect(platformConfigFromProfile({})).toBeUndefined();
  });

  test("returns the profile platform settings that are set", () => {
    expect(
      platformConfigFromProfile({
        platform_url: "https://api.dev.tailor.tech",
        oauth2_client_id: "dev-client",
        console_url: "https://console.dev.tailor.tech",
      }),
    ).toEqual({
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
      consoleUrl: "https://console.dev.tailor.tech",
    });
  });
});

describe("profile readonly field", () => {
  beforeEach(() => {
    resetKeyringState();
  });

  test("round-trips readonly: true through write/read", async () => {
    writePlatformConfig(
      v2Config({
        profiles: {
          ro: profile("u@example.com", { readonly: true }),
          rw: profile("u@example.com"),
        },
      }),
    );
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();
    expect(config.profiles.ro?.readonly).toBe(true);
    expect(config.profiles.rw?.readonly).toBeUndefined();
  });
});

describe("V1 to V2 migration", () => {
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

  beforeEach(() => {
    resetKeyringState();
  });

  test("migrates V1 config to V2 in memory without rewriting disk", async () => {
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    writePlatformConfig({
      version: 1,
      users: {
        "user@example.com": {
          access_token: "v1-access-token",
          refresh_token: "v1-refresh-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {
        default: profile("user@example.com"),
      },
      current_user: "user@example.com",
    });

    // readPlatformConfig triggers in-memory migration
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();

    // In-memory: V2 with storage: "file"
    expect(config.version).toBe(2);
    const userEntry = config.users["user@example.com"];
    expect(userEntry).toBeDefined();
    expect(userEntry!.storage).toBe("file");
    expect(userEntry!.token_expires_at).toBe(futureDate);
    if (userEntry!.storage !== "file") {
      throw new Error("Expected file-backed user entry");
    }
    expect(userEntry!.access_token).toBe("v1-access-token");
    expect(userEntry!.refresh_token).toBe("v1-refresh-token");

    // Disk: still V1 (not rewritten to V2)
    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as { version: number };
    expect(diskConfig.version).toBe(1);
  });
});

describe("keyring user persistence on V2 -> V1 downgrade", () => {
  const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    resetKeyringState();
    process.env = { ...originalEnv };
    // Downgrade only happens when TAILOR_USE_KEYRING is unset, which is the
    // default for every command that is not opting into keyring storage.
    delete process.env.TAILOR_USE_KEYRING;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("keeps the config V2 and preserves the keyring user when written without TAILOR_USE_KEYRING", async () => {
    writePlatformConfig(
      v2Config({
        users: {
          "keyring@example.com": { storage: "keyring", token_expires_at: futureDate },
          "file@example.com": {
            storage: "file",
            access_token: "file-access-token",
            refresh_token: "file-refresh-token",
            token_expires_at: futureDate,
          },
        },
        current_user: "keyring@example.com",
      }),
    );

    // Disk: stays V2 so the keyring entry is not dropped.
    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as {
      version: number;
      users: Record<string, { storage?: string }>;
      current_user: string | null;
    };
    expect(diskConfig.version).toBe(2);
    expect(diskConfig.users["keyring@example.com"]?.storage).toBe("keyring");
    expect(diskConfig.users["file@example.com"]?.storage).toBe("file");
    expect(diskConfig.current_user).toBe("keyring@example.com");

    // Round trip: the keyring user (and current_user) survive a re-read.
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();
    expect(config.version).toBe(2);
    expect(config.users["keyring@example.com"]?.storage).toBe("keyring");
    expect(config.current_user).toBe("keyring@example.com");
  });

  test("still downgrades a file-only config to V1 for backward compatibility", () => {
    writePlatformConfig(
      v2Config({
        users: {
          "file@example.com": {
            storage: "file",
            access_token: "file-access-token",
            token_expires_at: futureDate,
          },
        },
        current_user: "file@example.com",
      }),
    );

    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as {
      version: number;
      current_user: string | null;
    };
    expect(diskConfig.version).toBe(1);
    expect(diskConfig.current_user).toBe("file@example.com");
  });

  test("keeps platform settings and scoped token keys in a min-SDK gated config format", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "file@example.com": {
          storage: "file",
          access_token: "file-access-token",
          token_expires_at: futureDate,
        },
        "https://api.dev.tailor.tech|file@example.com": {
          storage: "file",
          access_token: "scoped-access-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {
        dev: {
          user: "file@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
          oauth2_client_id: "dev-client",
          console_url: "https://console.dev.tailor.tech",
        },
      },
      current_user: "file@example.com",
    });

    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as {
      version: number;
      min_sdk_version?: string;
      users: Record<string, unknown>;
      profiles: Record<
        string,
        {
          platform_url?: string;
          oauth2_client_id?: string;
          console_url?: string;
        }
      >;
    };
    expect(diskConfig.version).toBe(3);
    expect(diskConfig.min_sdk_version).toBe("1.70.0");
    expect(diskConfig.profiles.dev?.platform_url).toBe("https://api.dev.tailor.tech");
    expect(diskConfig.profiles.dev?.oauth2_client_id).toBe("dev-client");
    expect(diskConfig.profiles.dev?.console_url).toBe("https://console.dev.tailor.tech");
    expect(diskConfig.users["https://api.dev.tailor.tech|file@example.com"]).toBeDefined();

    const config = await readPlatformConfig();
    expect(config.profiles.dev?.platform_url).toBe("https://api.dev.tailor.tech");
  });

  test("clears current_user on V1 downgrade when it points at a user not representable in V1", () => {
    writePlatformConfig(
      v2Config({
        users: {
          "file@example.com": {
            storage: "file",
            access_token: "file-access-token",
            token_expires_at: futureDate,
          },
        },
        // current_user references a user that is not in the users map, so it
        // cannot be represented in V1 and must be cleared on downgrade.
        current_user: "missing@example.com",
      }),
    );

    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as {
      version: number;
      current_user: string | null;
    };
    expect(diskConfig.version).toBe(1);
    expect(diskConfig.current_user).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("writePlatformConfig file permissions", () => {
  test("writes the config file with mode 0600 and its directory with mode 0700", () => {
    writePlatformConfig(v2Config());

    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    const fileMode = fs.statSync(configPath).mode & 0o777;
    const dirMode = fs.statSync(path.dirname(configPath)).mode & 0o777;

    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  test("tightens permissions when overwriting a config file that was world-readable", () => {
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "stale: true", { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    writePlatformConfig(v2Config());

    const fileMode = fs.statSync(configPath).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  test("tightens existing world-readable config on read, without a write", async () => {
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.chmodSync(path.dirname(configPath), 0o755);
    const yaml =
      "version: 2\nmin_sdk_version: 1.29.0\nusers: {}\nprofiles: {}\ncurrent_user: null\n";
    fs.writeFileSync(configPath, yaml, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    const { readPlatformConfig } = await import("./context");
    await readPlatformConfig();

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(configPath)).mode & 0o777).toBe(0o700);
  });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});
