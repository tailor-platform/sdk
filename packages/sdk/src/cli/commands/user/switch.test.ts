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
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("stores the bare user when switching to a PLATFORM_URL-scoped token", async () => {
    vi.stubEnv("PLATFORM_URL", "https://api.dev.tailor.tech");

    const result = await runCommand(switchCommand, ["u@example.com"]);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.current_user).toBe("u@example.com");
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
