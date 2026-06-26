import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writePlatformConfig } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resetKeyringState } from "#/cli/shared/token-store";
import { userCommand } from ".";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-user-list-${Date.now()}-${Math.random()}`);

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

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("user list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("honors logger jsonMode when no users exist and parent command delegates without json args", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(userCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });

  test("honors logger jsonMode for users when parent command delegates without json args", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "file",
          access_token: "token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });

    using stdout = captureStdout();
    using _json = jsonMode();

    await runCommand(userCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual(["u@example.com"]);
  });

  test("renders scoped users as user-facing entries in json mode", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });

    using stdout = captureStdout();
    using _json = jsonMode();

    await runCommand(userCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual(["u@example.com"]);
  });

  test("renders scoped users without exposing the storage key in text mode", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });

    using stderr = captureStderr();

    await runCommand(userCommand, []);

    expect(stderr.output).toContain("u@example.com");
    expect(stderr.output).toContain("https://api.dev.tailor.tech");
    expect(stderr.output).not.toContain("https://api.dev.tailor.tech|u@example.com");
  });

  test("marks the active profile user as current in text mode", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "default@example.com": {
          storage: "file",
          access_token: "default-token",
          refresh_token: "default-refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
        "https://api.dev.tailor.tech|profile@example.com": {
          storage: "file",
          access_token: "profile-token",
          refresh_token: "profile-refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {
        dev: {
          user: "profile@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: "default@example.com",
    });

    using stderr = captureStderr();

    await runCommand(userCommand, []);

    expect(stderr.output).toContain("profile@example.com [https://api.dev.tailor.tech] (current)");
    expect(stderr.output).toContain("default@example.com");
    expect(stderr.output).not.toContain("default@example.com (current)");
  });
});
