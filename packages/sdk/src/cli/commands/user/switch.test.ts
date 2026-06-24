import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
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

    using _stderr = captureStderr();

    await runCommand(switchCommand, ["user@example.com"]);

    const config = await readPlatformConfig();
    expect(config.current_user).toBe("platform-user-sub");
  });
});
