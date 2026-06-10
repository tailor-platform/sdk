import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML } from "confbox";
import * as path from "pathe";
import { describe, expect, test, vi, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import { loadAccessToken, loadConfigPath, loadWorkspaceId, writePlatformConfig } from "./context";
import { logger } from "./logger";
import { resetKeyringState } from "./token-store";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-xdg-${Date.now()}-${Math.random()}`);

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
      const result = await loadAccessToken({ useProfile: true, profile: "myprofile" });
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
    test("returns token from profile when useProfile is true and profile provided", async () => {
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
      const result = await loadAccessToken({ useProfile: true, profile: "myprofile" });
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
      await expect(loadAccessToken({ useProfile: true, profile: "nonexistent" })).rejects.toThrow(
        'Profile "nonexistent" not found',
      );
    });

    test("does not use profile when useProfile is false", async () => {
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
        profiles: {
          myprofile: { user: "profileuser", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        },
        current_user: "currentuser",
      });
      const result = await loadAccessToken({ useProfile: false, profile: "myprofile" });
      expect(result).toBe(validToken);
    });
  });

  describe("env.TAILOR_PLATFORM_PROFILE", () => {
    test("returns token from env profile when useProfile is true", async () => {
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
      const result = await loadAccessToken({ useProfile: true });
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
      const result = await loadAccessToken({ useProfile: true, profile: "optsprofile" });
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
        default: { user: "user@example.com", workspace_id: "12345678-1234-4abc-8def-123456789012" },
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

    // Round trip: the keyring user (and current_user) survive a re-read.
    const { readPlatformConfig } = await import("./context");
    const config = await readPlatformConfig();
    expect(config.version).toBe(2);
    expect(config.users["keyring@example.com"]?.storage).toBe("keyring");
    expect(config.current_user).toBe("keyring@example.com");
  });

  test("still downgrades a file-only config to V1 for backward compatibility", () => {
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
