import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import { loadConfigPath, loadWorkspaceId, writePlatformConfig } from "./context";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-xdg-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
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

  it("returns explicit config path when provided", () => {
    const result = loadConfigPath("/explicit/path/config.ts");
    expect(result).toBe("/explicit/path/config.ts");
  });

  it("returns env config path when set", () => {
    process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH = "/env/path/config.ts";
    const result = loadConfigPath();
    expect(result).toBe("/env/path/config.ts");
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
  const originalEnv = process.env;
  const validUUID = "12345678-1234-4abc-8def-123456789012";
  const invalidUUID = "not-a-uuid";

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.TAILOR_PLATFORM_WORKSPACE_ID;
    delete process.env.TAILOR_PLATFORM_PROFILE;
    writePlatformConfig({
      version: 1,
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
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

    it("opts.workspaceId takes precedence over env variable", () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const result = loadWorkspaceId({ workspaceId: validUUID });
      expect(result).toBe(validUUID);
    });
  });

  describe("env.TAILOR_PLATFORM_WORKSPACE_ID", () => {
    it("returns workspaceId from env when opts not provided", () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = validUUID;
      const result = loadWorkspaceId();
      expect(result).toBe(validUUID);
    });

    it("throws error when env workspaceId is invalid UUID", () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = invalidUUID;
      expect(() => loadWorkspaceId()).toThrow(
        "Invalid value from TAILOR_PLATFORM_WORKSPACE_ID environment variable: must be a valid UUID",
      );
    });

    it("env takes precedence over profile", () => {
      process.env.TAILOR_PLATFORM_WORKSPACE_ID = validUUID;
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: {
          myprofile: { user: "test", workspace_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        },
        current_user: null,
      });
      const result = loadWorkspaceId({ profile: "myprofile" });
      expect(result).toBe(validUUID);
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

    it("throws error when profile not found", () => {
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: {},
        current_user: null,
      });
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

  describe("env.TAILOR_PLATFORM_PROFILE", () => {
    it("returns workspaceId from env profile when set", () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: { envprofile: { user: "testuser", workspace_id: validUUID } },
        current_user: null,
      });
      const result = loadWorkspaceId();
      expect(result).toBe(validUUID);
    });

    it("opts.profile takes precedence over env profile", () => {
      process.env.TAILOR_PLATFORM_PROFILE = "envprofile";
      writePlatformConfig({
        version: 1,
        users: {},
        profiles: {
          envprofile: { user: "testuser", workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          optsprofile: { user: "testuser", workspace_id: validUUID },
        },
        current_user: null,
      });
      const result = loadWorkspaceId({ profile: "optsprofile" });
      expect(result).toBe(validUUID);
    });
  });

  describe("error case: no workspace ID source", () => {
    it("throws error when no workspaceId source is available", () => {
      expect(() => loadWorkspaceId()).toThrow("Workspace ID not found");
    });
  });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});
