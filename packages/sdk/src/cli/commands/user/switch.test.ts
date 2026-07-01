import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { resetKeyringState } from "#/cli/shared/token-store";
import { switchCommand } from "./switch";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-user-switch-${Date.now()}-${Math.random()}`);

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

describe("user switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("stores the subject-keyed user when switching by email metadata", async () => {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {
        "platform-user-sub": {
          storage: "file",
          access_token: "token",
          refresh_token: "refresh",
          token_expires_at: "2999-01-01T00:00:00.000Z",
          email: "user@example.com",
        },
      },
      profiles: {},
      current_user: null,
    });

    const result = await runCommand(switchCommand, ["user@example.com"]);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.current_user).toBe("platform-user-sub");
  });

  test("stores the bare user when switching to a TAILOR_PLATFORM_URL-scoped token", async () => {
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "token",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {},
      current_user: null,
    });

    const result = await runCommand(switchCommand, ["u@example.com"]);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.current_user).toBe("u@example.com");
  });

  test("updates the active profile user when switching users", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {
        "https://api.dev.tailor.tech|other@example.com": {
          storage: "file",
          access_token: "other-token",
          token_expires_at: "2999-01-01T00:00:00.000Z",
        },
      },
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    });

    const result = await runCommand(switchCommand, ["other@example.com"]);

    expect(result.success).toBe(true);
    const updatedConfig = await readPlatformConfig();
    expect(updatedConfig.profiles.dev?.user).toBe("other@example.com");
    expect(updatedConfig.current_user).toBeNull();
  });

  test("rejects scoped token keys as current user values", async () => {
    const result = await runCommand(switchCommand, ["https://api.dev.tailor.tech|u@example.com"]);

    expect(result.success).toBe(false);
    expect((result as { error?: Error }).error?.message).toContain(
      "looks like a platform-scoped token key",
    );
    const config = await readPlatformConfig();
    expect(config.current_user).toBeNull();
  });
});
