import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import { loadAccessToken, loadConfigPath, loadWorkspaceId, writePlatformConfig } from "./context";
import { logger } from "./logger";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-xdg-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
}));

describe("loadConfigPath", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns explicit config path when provided", () => {
    const result = loadConfigPath("/explicit/path/config.ts");
    expect(result).toBe("/explicit/path/config.ts");
  });

  it("finds config in current directory", () => {
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  it("finds config in parent directory", () => {
    const nestedDir = path.join(tempDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(nestedDir);
    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  it("finds config in grandparent directory", () => {
    const deepNestedDir = path.join(tempDir, "nested", "deep");
    fs.mkdirSync(deepNestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(deepNestedDir);
    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  it("prefers config in closer directory", () => {
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

  it("returns undefined when config not found", () => {
    const result = loadConfigPath();
    expect(result).toBeUndefined();
  });
});

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

describe("loadWorkspaceId", () => {
  const validUUID = "12345678-1234-4abc-8def-123456789012";
  const invalidUUID = "not-a-uuid";

  beforeEach(() => {
    vi.resetModules();
    writePlatformConfig({
      version: 1,
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("opts.workspaceId", () => {
    it("returns workspaceId from options when provided", () => {
      const result = loadWorkspaceId({ workspaceId: validUUID });
      expect(result).toBe(validUUID);
    });

    it("throws error when opts.workspaceId is invalid UUID", () => {
      expect(() => loadWorkspaceId({ workspaceId: invalidUUID })).toThrow(
        "Invalid value from --workspace-id option: must be a valid UUID",
      );
    });
  });

  describe("opts.profile", () => {
    it("returns workspaceId from profile when opts.profile provided", () => {
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: { myprofile: { user: "testuser", workspace_id: validUUID } },
        current_user: null,
      });
      const result = loadWorkspaceId({ profile: "myprofile" });
      expect(result).toBe(validUUID);
    });

    it("workspaceId takes precedence over profile", () => {
      const otherUUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: { myprofile: { user: "testuser", workspace_id: otherUUID } },
        current_user: null,
      });
      const result = loadWorkspaceId({ workspaceId: validUUID, profile: "myprofile" });
      expect(result).toBe(validUUID);
    });

    it("throws error when profile not found", () => {
      expect(() => loadWorkspaceId({ profile: "nonexistent" })).toThrow(
        'Profile "nonexistent" not found',
      );
    });

    it("throws error when profile workspace_id is invalid UUID", () => {
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: { badprofile: { user: "testuser", workspace_id: invalidUUID } },
        current_user: null,
      });
      expect(() => loadWorkspaceId({ profile: "badprofile" })).toThrow(
        'Invalid value from profile "badprofile": must be a valid UUID',
      );
    });
  });

  describe("error case: no workspace ID source", () => {
    it("throws error when no workspaceId source is available", () => {
      expect(() => loadWorkspaceId()).toThrow("Workspace ID not found");
    });
  });
});

describe("loadAccessToken", () => {
  const validToken = "valid-access-token";
  const otherToken = "other-access-token";
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

  beforeEach(() => {
    vi.resetModules();
    // Explicitly stub env vars to undefined instead of using vi.unstubAllEnvs().
    // unstubAllEnvs() restores to original values, not undefined, so if these
    // vars are set in the real environment, they would leak into tests.
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_TOKEN", undefined);
    writePlatformConfig({
      version: 1,
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("env.TAILOR_PLATFORM_TOKEN", () => {
    it("returns token from TAILOR_PLATFORM_TOKEN when set", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    it("TAILOR_PLATFORM_TOKEN takes precedence over TAILOR_TOKEN", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      vi.stubEnv("TAILOR_TOKEN", otherToken);
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
    });

    it("TAILOR_PLATFORM_TOKEN takes precedence over profile", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", validToken);
      writePlatformConfig({
        version: 1,
        users: {
          testuser: {
            access_token: otherToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
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
    it("returns token from TAILOR_TOKEN when TAILOR_PLATFORM_TOKEN not set", async () => {
      vi.stubEnv("TAILOR_TOKEN", validToken);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const result = await loadAccessToken();
      expect(result).toBe(validToken);
      expect(warnSpy).toHaveBeenCalledWith(
        "TAILOR_TOKEN is deprecated. Please use TAILOR_PLATFORM_TOKEN instead.",
      );
    });
  });

  describe("opts.profile", () => {
    it("returns token from profile when useProfile is true and profile provided", async () => {
      writePlatformConfig({
        version: 1,
        users: {
          testuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
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

    it("throws error when profile not found", async () => {
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: {},
        current_user: null,
      });
      await expect(loadAccessToken({ useProfile: true, profile: "nonexistent" })).rejects.toThrow(
        'Profile "nonexistent" not found',
      );
    });

    it("does not use profile when useProfile is false", async () => {
      writePlatformConfig({
        version: 1,
        users: {
          currentuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
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

  describe("config.current_user", () => {
    it("returns token from current_user when no env or profile", async () => {
      writePlatformConfig({
        version: 1,
        users: {
          currentuser: {
            access_token: validToken,
            refresh_token: "refresh",
            token_expires_at: futureDate,
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
    it("throws error when no token source is available", async () => {
      await expect(loadAccessToken()).rejects.toThrow("Tailor Platform token not found");
    });
  });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});
