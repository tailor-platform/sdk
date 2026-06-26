import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { writePlatformConfig } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resetKeyringState } from "#/cli/shared/token-store";
import { listCommand } from "./list";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-user-pat-list-${Date.now()}-${Math.random()}`);

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

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("user pat list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.mocked(initOperatorClient).mockResolvedValue({
      listPersonalAccessTokens: vi.fn().mockResolvedValue({
        personalAccessTokens: [],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("uses the active profile platform when loading the current user's token", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          access_token: "scoped-token",
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
    using _json = jsonMode();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token", {
      platformUrl: "https://api.dev.tailor.tech",
    });
  });
});
