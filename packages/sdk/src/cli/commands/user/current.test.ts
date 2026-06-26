import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writePlatformConfig } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resetKeyringState } from "#/cli/shared/token-store";
import { currentCommand } from "./current";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-user-current-${Date.now()}-${Math.random()}`);

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

const validUUID = "12345678-1234-4abc-8def-123456789012";

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("user current", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
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
      profiles: {
        dev: { user: "u@example.com", workspace_id: validUUID },
      },
      current_user: "u@example.com",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("with jsonMode emits a parseable current-user object to stdout", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();

    await runCommand(currentCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual({ user: "u@example.com" });
  });

  test("accepts a current user whose tokens are scoped to PLATFORM_URL", async () => {
    vi.stubEnv("PLATFORM_URL", "https://api.dev.tailor.tech");
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

    await runCommand(currentCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({ user: "u@example.com" });
  });

  test("accepts a current user whose tokens are scoped to the active profile platform", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
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
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: "u@example.com",
    });
    using stdout = captureStdout();
    using _json = jsonMode();

    await runCommand(currentCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({ user: "u@example.com" });
  });

  test("shows the active profile user instead of the global current user", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "default@example.com": {
          storage: "file",
          access_token: "default-token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
        "https://api.dev.tailor.tech|profile@example.com": {
          storage: "file",
          access_token: "profile-token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {
        dev: {
          user: "profile@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: "default@example.com",
    });
    using stdout = captureStdout();
    using _json = jsonMode();

    await runCommand(currentCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({ user: "profile@example.com" });
  });
});
