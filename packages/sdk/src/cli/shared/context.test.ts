import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML } from "confbox";
import * as path from "pathe";
import { describe, expect, test, vi, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import {
  fetchLatestToken,
  loadAccessToken,
  loadConfigPath,
  loadMachineUserName,
  loadWorkspaceId,
  readPlatformConfig,
  saveUserTokens,
  writePlatformConfig,
} from "./context";
import { isCLIError } from "./errors";
import { logger } from "./logger";
import { isKeyringAvailable, resetKeyringState } from "./token-store";
import type * as ClientModule from "./client";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-xdg-${Date.now()}-${Math.random()}`);
const keyringPasswords = vi.hoisted(() => new Map<string, string>());
const keyringSetPasswordFailure = vi.hoisted(() => ({ error: undefined as Error | undefined }));

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
      if (keyringSetPasswordFailure.error) throw keyringSetPasswordFailure.error;
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
}));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    fetchUserInfo: clientMocks.fetchUserInfo,
    initOAuth2Client: () => ({
      refreshToken: clientMocks.refreshToken,
    }),
  };
});

beforeEach(() => {
  clientMocks.fetchUserInfo.mockReset();
  clientMocks.refreshToken.mockReset();
  keyringPasswords.clear();
  keyringSetPasswordFailure.error = undefined;
});

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

  test("finds config in parent directory", () => {
    const nestedDir = path.join(tempDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(nestedDir);
    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  test("finds config in grandparent directory", () => {
    const deepNestedDir = path.join(tempDir, "nested", "deep");
    fs.mkdirSync(deepNestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(deepNestedDir);
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
    resetKeyringState();
    process.env = { ...originalEnv };
    delete process.env.TAILOR_PLATFORM_WORKSPACE_ID;
    delete process.env.TAILOR_PLATFORM_PROFILE;
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("opts.workspaceId", () => {
    test("returns workspaceId from options when provided", async () => {
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
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: {
          myprofile: { user: "test", workspace_id: otherUUID },
        },
        current_user: null,
      });
      const result = await loadWorkspaceId({ profile: "myprofile" });
      expect(result).toBe(validUUID);
    });
  });

  describe("opts.profile", () => {
    test("returns workspaceId from profile when opts.profile provided", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: { myprofile: { user: "testuser", workspace_id: validUUID } },
        current_user: null,
      });
      const result = await loadWorkspaceId({ profile: "myprofile" });
      expect(result).toBe(validUUID);
    });

    test("throws error when profile not found", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: {},
        current_user: null,
      });
      await expect(loadWorkspaceId({ profile: "nonexistent" })).rejects.toThrow(
        'Profile "nonexistent" not found',
      );
    });

    test("throws error when profile workspace_id is invalid UUID", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: { badprofile: { user: "testuser", workspace_id: invalidUUID } },
        current_user: null,
      });
      await expect(loadWorkspaceId({ profile: "badprofile" })).rejects.toThrow(
        'Invalid value from profile "badprofile": must be a valid UUID',
      );
    });
  });

  describe("env.TAILOR_PLATFORM_PROFILE", () => {
    test("returns workspaceId from env profile when set", async () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: { envprofile: { user: "testuser", workspace_id: validUUID } },
        current_user: null,
      });
      const result = await loadWorkspaceId();
      expect(result).toBe(validUUID);
    });

    test("opts.profile takes precedence over env profile", async () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: {
          envprofile: { user: "testuser", workspace_id: otherUUID },
          optsprofile: { user: "testuser", workspace_id: validUUID },
        },
        current_user: null,
      });
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
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: { myprofile: { user: "u", workspace_id: validUUID, machine_user: "profile-bot" } },
      current_user: null,
    });
    const result = await loadMachineUserName({ profile: "myprofile" });
    expect(result).toBe("env-bot");
  });

  test("returns machine_user from profile when profile provided", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: { myprofile: { user: "u", workspace_id: validUUID, machine_user: "profile-bot" } },
      current_user: null,
    });
    const result = await loadMachineUserName({ profile: "myprofile" });
    expect(result).toBe("profile-bot");
  });

  test("returns undefined when profile has no machine_user", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: { myprofile: { user: "u", workspace_id: validUUID } },
      current_user: null,
    });
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
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        envprofile: { user: "u", workspace_id: validUUID, machine_user: "env-profile-bot" },
      },
      current_user: null,
    });
    const result = await loadMachineUserName();
    expect(result).toBe("env-profile-bot");
  });

  describe("machine_user_override: deny", () => {
    beforeEach(() => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: {
          locked: {
            user: "u",
            workspace_id: validUUID,
            machine_user: "profile-bot",
            machine_user_override: "deny",
          },
        },
        current_user: null,
      });
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
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: { user: "u", workspace_id: validUUID, machine_user: "profile-bot" },
      },
      current_user: null,
    });
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
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: { myprofile: { user: "u", workspace_id: validUUID, machine_user: "profile-bot" } },
      current_user: null,
    });
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
  const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();

  beforeEach(() => {
    vi.resetModules();
    resetKeyringState();
    // Explicitly stub env vars to undefined instead of using vi.unstubAllEnvs().
    // unstubAllEnvs() restores to original values, not undefined, so if these
    // vars are set in the real environment, they would leak into tests.
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_TOKEN", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  describe("env.TAILOR_PLATFORM_TOKEN", () => {
    test("returns token from TAILOR_PLATFORM_TOKEN when set", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
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
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          testuser: {
            access_token: otherToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
        },
        profiles: {
          myprofile: { user: "testuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        },
        current_user: null,
      });
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
          myprofile: { user: "testuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        },
        current_user: null,
      });
      const result = await loadAccessToken({ profile: "myprofile" });
      expect(result).toBe(validToken);
    });

    test("throws error when profile not found", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {},
        profiles: {},
        current_user: null,
      });
      await expect(loadAccessToken({ profile: "nonexistent" })).rejects.toThrow(
        'Profile "nonexistent" not found',
      );
    });

    test("prefers the profile user over current_user", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          currentuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
          profileuser: {
            access_token: otherToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
        },
        profiles: {
          myprofile: { user: "profileuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        },
        current_user: "currentuser",
      });
      const result = await loadAccessToken({ profile: "myprofile" });
      expect(result).toBe(otherToken);
    });
  });

  describe("env.TAILOR_PLATFORM_PROFILE", () => {
    test("returns token from env profile", async () => {
      vi.stubEnv("TAILOR_PLATFORM_PROFILE", "envprofile");
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
          envprofile: { user: "testuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        },
        current_user: null,
      });
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    test("opts.profile takes precedence over env profile", async () => {
      vi.stubEnv("TAILOR_PLATFORM_PROFILE", "envprofile");
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          envuser: {
            access_token: otherToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
          optsuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
        },
        profiles: {
          envprofile: { user: "envuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
          optsprofile: { user: "optsuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        },
        current_user: null,
      });
      const result = await loadAccessToken({ profile: "optsprofile" });
      expect(result).toBe(validToken);
    });
  });

  describe("config.current_user", () => {
    test("returns token from current_user when no env or profile", async () => {
      writePlatformConfig({
        version: 2,
        min_sdk_version: "1.29.0",
        users: {
          currentuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            storage: "file",
          },
        },
        profiles: {},
        current_user: "currentuser",
      });
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    test("fetchLatestToken resolves a subject-keyed user by email metadata", async () => {
      writePlatformConfig({
        version: 3,
        min_sdk_version: "2.0.0",
        users: {
          "platform-user-sub": {
            storage: "file",
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
            email: "user@example.com",
          },
        },
        profiles: {},
        current_user: "platform-user-sub",
      });

      const config = await readPlatformConfig();
      await expect(fetchLatestToken(config, "user@example.com")).resolves.toEqual({
        accessToken: validToken,
        user: "platform-user-sub",
      });
    });

    test("refreshes a legacy email-key user into a subject-key V3 config", async () => {
      clientMocks.refreshToken.mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: Date.now() + 3600 * 1000,
      });
      clientMocks.fetchUserInfo.mockResolvedValue({
        sub: "platform-user-sub",
        email: "legacy@example.com",
      });
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
        profiles: {
          default: {
            user: "legacy@example.com",
            workspace_id: "12345678-1234-4abc-8def-123456789012",
          },
        },
        current_user: "legacy@example.com",
      });

      const token = await loadAccessToken();
      const config = await readPlatformConfig();

      expect(token).toBe("new-access-token");
      expect(clientMocks.fetchUserInfo).toHaveBeenCalledWith("new-access-token");
      expect(config.version).toBe(3);
      expect(config.users["legacy@example.com"]).toBeUndefined();
      expect(config.users["platform-user-sub"]).toMatchObject({
        storage: "keyring",
        email: "legacy@example.com",
      });
      expect(keyringPasswords.get("tailor-platform-cli:platform-user-sub")).toBe(
        JSON.stringify({ accessToken: "new-access-token", refreshToken: "new-refresh-token" }),
      );
      expect(config.current_user).toBe("platform-user-sub");
      expect(config.profiles.default?.user).toBe("platform-user-sub");
    });

    test("logs when refresh updates the stored user email", async () => {
      clientMocks.refreshToken.mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: Date.now() + 3600 * 1000,
      });
      clientMocks.fetchUserInfo.mockResolvedValue({
        sub: "platform-user-sub",
        email: "new@example.com",
      });
      writePlatformConfig({
        version: 3,
        min_sdk_version: "2.0.0",
        users: {
          "platform-user-sub": {
            access_token: "expired-access-token",
            refresh_token: "refresh",
            token_expires_at: pastDate,
            storage: "file",
            email: "old@example.com",
          },
        },
        profiles: {},
        current_user: "platform-user-sub",
      });

      const config = await readPlatformConfig();
      using infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});

      await fetchLatestToken(config, "platform-user-sub");

      expect(infoSpy).toHaveBeenCalledWith(
        'Updated local user email from "old@example.com" to "new@example.com".',
      );
      expect(config.users["platform-user-sub"]?.email).toBe("new@example.com");
    });

    test("keeps the legacy email key when subject resolution fails on refresh", async () => {
      clientMocks.refreshToken.mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: Date.now() + 3600 * 1000,
      });
      clientMocks.fetchUserInfo.mockRejectedValue(new Error("network down"));
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
        profiles: {
          default: {
            user: "legacy@example.com",
            workspace_id: "12345678-1234-4abc-8def-123456789012",
          },
        },
        current_user: "legacy@example.com",
      });

      const token = await loadAccessToken();
      const config = await readPlatformConfig();

      expect(token).toBe("new-access-token");
      expect(clientMocks.fetchUserInfo).toHaveBeenCalledWith("new-access-token");
      expect(config.users["platform-user-sub"]).toBeUndefined();
      expect(config.users["legacy@example.com"]).toMatchObject({
        storage: "keyring",
      });
      expect(keyringPasswords.get("tailor-platform-cli:legacy@example.com")).toBe(
        JSON.stringify({ accessToken: "new-access-token", refreshToken: "new-refresh-token" }),
      );
      expect(config.current_user).toBe("legacy@example.com");
      expect(config.profiles.default?.user).toBe("legacy@example.com");
    });
  });

  describe("error case: no token source", () => {
    test("throws error when no token source is available", async () => {
      await expect(loadAccessToken()).rejects.toThrow("Tailor Platform token not found");
    });
  });
});

describe("profile readonly field", () => {
  beforeEach(() => {
    resetKeyringState();
  });

  test("round-trips readonly: true through write/read", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        ro: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          readonly: true,
        },
        rw: { user: "u@example.com", workspace_id: "12345678-1234-4abc-8def-123456789012" },
      },
      current_user: null,
    });
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();
    expect(config.profiles.ro?.readonly).toBe(true);
    expect(config.profiles.rw?.readonly).toBeUndefined();
  });
});

describe("saveUserTokens", () => {
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
  const originalEnv = process.env;
  type PlatformConfig = Parameters<typeof saveUserTokens>[0];

  function createEmptyConfig(): PlatformConfig {
    return {
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: {},
      current_user: null,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    resetKeyringState();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("stores tokens in the OS keyring by default when available", async () => {
    const config = createEmptyConfig();

    await saveUserTokens(
      config,
      "platform-user-sub",
      { accessToken: "access-token", refreshToken: "refresh-token" },
      futureDate,
      { email: "user@example.com" },
    );

    expect(config.users["platform-user-sub"]).toEqual({
      storage: "keyring",
      token_expires_at: futureDate,
      email: "user@example.com",
    });
    expect(keyringPasswords.get("tailor-platform-cli:platform-user-sub")).toBe(
      JSON.stringify({ accessToken: "access-token", refreshToken: "refresh-token" }),
    );
  });

  test.each(["0", "false", "off"])(
    "ignores TAILOR_USE_KEYRING=%s and stores tokens in the OS keyring",
    async (value) => {
      process.env.TAILOR_USE_KEYRING = value;
      const config = createEmptyConfig();

      await saveUserTokens(
        config,
        "platform-user-sub",
        { accessToken: "access-token", refreshToken: "refresh-token" },
        futureDate,
      );

      expect(config.users["platform-user-sub"]).toEqual({
        storage: "keyring",
        token_expires_at: futureDate,
      });
      expect(keyringPasswords.get("tailor-platform-cli:platform-user-sub")).toBe(
        JSON.stringify({ accessToken: "access-token", refreshToken: "refresh-token" }),
      );
    },
  );

  test("falls back to the config file when keyring storage fails", async () => {
    const config = createEmptyConfig();

    expect(await isKeyringAvailable()).toBe(true);
    keyringSetPasswordFailure.error = new Error("keyring denied");
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await saveUserTokens(
      config,
      "platform-user-sub",
      { accessToken: "access-token", refreshToken: "refresh-token" },
      futureDate,
    );

    expect(config.users["platform-user-sub"]).toEqual({
      storage: "file",
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_expires_at: futureDate,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keyring denied"));
  });

  test("deletes stale keyring tokens when falling back to the config file", async () => {
    const config = createEmptyConfig();
    config.users["platform-user-sub"] = {
      storage: "keyring",
      token_expires_at: futureDate,
    };
    keyringPasswords.set(
      "tailor-platform-cli:platform-user-sub",
      JSON.stringify({ accessToken: "stale-access-token", refreshToken: "stale-refresh-token" }),
    );

    expect(await isKeyringAvailable()).toBe(true);
    keyringSetPasswordFailure.error = new Error("keyring denied");
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await saveUserTokens(
      config,
      "platform-user-sub",
      { accessToken: "access-token", refreshToken: "refresh-token" },
      futureDate,
    );

    expect(config.users["platform-user-sub"]).toEqual({
      storage: "file",
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_expires_at: futureDate,
    });
    expect(keyringPasswords.has("tailor-platform-cli:platform-user-sub")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keyring denied"));
  });
});

describe("V1 to V3 migration", () => {
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

  beforeEach(() => {
    resetKeyringState();
  });

  test("migrates V1 config to V3 in memory without rewriting disk", async () => {
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
        default: { user: "user@example.com", workspace_id: "12345678-1234-4abc-8def-123456789012" },
      },
      current_user: "user@example.com",
    });

    // readPlatformConfig triggers in-memory migration
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();

    // In-memory: V3 with storage: "file" and inferred legacy email metadata.
    expect(config.version).toBe(3);
    const userEntry = config.users["user@example.com"];
    expect(userEntry).toBeDefined();
    expect(userEntry!.storage).toBe("file");
    expect(userEntry!.email).toBe("user@example.com");
    expect(userEntry!.token_expires_at).toBe(futureDate);
    if (userEntry!.storage !== "file") {
      throw new Error("Expected file-backed user entry");
    }
    expect(userEntry!.access_token).toBe("v1-access-token");
    expect(userEntry!.refresh_token).toBe("v1-refresh-token");

    // Disk: still V1 (not rewritten to V3)
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
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("keeps the config V2 and preserves the keyring user", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "keyring@example.com": { storage: "keyring", token_expires_at: futureDate },
        "file@example.com": {
          storage: "file",
          access_token: "file-access-token",
          refresh_token: "file-refresh-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {},
      current_user: "keyring@example.com",
    });

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

    // Round trip: the keyring user (and current_user) survive a re-read and
    // are exposed through the latest in-memory config version.
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();
    expect(config.version).toBe(3);
    expect(config.users["keyring@example.com"]?.storage).toBe("keyring");
    expect(config.users["keyring@example.com"]?.email).toBe("keyring@example.com");
    expect(config.current_user).toBe("keyring@example.com");
  });

  test("keeps V3 configs as V3 because subject IDs and email metadata cannot downgrade", () => {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {
        "platform-user-sub": {
          storage: "file",
          access_token: "file-access-token",
          refresh_token: "file-refresh-token",
          token_expires_at: futureDate,
          email: "user@example.com",
        },
      },
      profiles: {
        default: {
          user: "platform-user-sub",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
        },
      },
      current_user: "platform-user-sub",
    });

    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as {
      version: number;
      users: Record<string, { email?: string }>;
      profiles: Record<string, { user: string }>;
      current_user: string | null;
    };
    expect(diskConfig.version).toBe(3);
    expect(diskConfig.users["platform-user-sub"]?.email).toBe("user@example.com");
    expect(diskConfig.profiles.default?.user).toBe("platform-user-sub");
    expect(diskConfig.current_user).toBe("platform-user-sub");
  });

  test("ignores TAILOR_USE_KEYRING and still downgrades a file-only config to V1", () => {
    process.env.TAILOR_USE_KEYRING = "1";

    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "file@example.com": {
          storage: "file",
          access_token: "file-access-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {},
      current_user: "file@example.com",
    });

    const diskConfig = parseYAML(fs.readFileSync(configPath, "utf-8")) as {
      version: number;
      current_user: string | null;
    };
    expect(diskConfig.version).toBe(1);
    expect(diskConfig.current_user).toBe("file@example.com");
  });

  test("clears current_user on V1 downgrade when it points at a user not representable in V1", () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "file@example.com": {
          storage: "file",
          access_token: "file-access-token",
          token_expires_at: futureDate,
        },
      },
      profiles: {},
      // current_user references a user that is not in the users map, so it
      // cannot be represented in V1 and must be cleared on downgrade.
      current_user: "missing@example.com",
    });

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
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });

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

    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });

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
