import * as fs from "node:fs";
import { runCommand } from "politty";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchPlatformMachineUserToken } from "#/cli/shared/client";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { prompt } from "#/cli/shared/prompt";
import { resetKeyringState } from "#/cli/shared/token-store";
import { loginCommand } from "./login";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-login-${Date.now()}-${Math.random()}`);

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
  closeConnectionPool: vi.fn(),
  fetchPlatformMachineUserToken: vi.fn(),
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn(),
    password: vi.fn(),
  },
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("login --profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    });
  });

  test("updates profile user when machine-user login mismatch is accepted", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(true);
    vi.mocked(fetchPlatformMachineUserToken).mockResolvedValue({
      accessToken: "dev-token",
      refreshToken: "",
      expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
    });

    const result = await runCommand(loginCommand, [
      "--profile",
      "dev",
      "--machine-user",
      "--client-id",
      "machine-client",
      "--client-secret",
      "secret",
    ]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).toHaveBeenCalledWith({
      message:
        'Profile "dev" is configured for "u@example.com", but login authenticated "machine-client". Update this profile to use "machine-client"?',
      default: false,
    });
    const pfConfig = await readPlatformConfig();
    expect(pfConfig.profiles.dev?.user).toBe("machine-client");
    expect(pfConfig.users["https://api.dev.tailor.tech|machine-client"]).toMatchObject({
      access_token: "dev-token",
    });
  });

  test("rejects machine-user login mismatch when profile update is declined", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(loginCommand, [
      "--profile",
      "dev",
      "--machine-user",
      "--client-id",
      "machine-client",
      "--client-secret",
      "secret",
    ]);

    expect(result.success).toBe(false);
    expect((result as { error?: Error }).error?.message).toContain(
      'Profile "dev" is configured for "u@example.com"',
    );
    expect(fetchPlatformMachineUserToken).not.toHaveBeenCalled();
    const pfConfig = await readPlatformConfig();
    expect(pfConfig.profiles.dev?.user).toBe("u@example.com");
  });

  test("offers to update other profiles using the same old user", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
        qa: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
        prod: {
          user: "other@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    });
    vi.mocked(prompt.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    vi.mocked(fetchPlatformMachineUserToken).mockResolvedValue({
      accessToken: "dev-token",
      refreshToken: "",
      expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
    });

    const result = await runCommand(loginCommand, [
      "--profile",
      "dev",
      "--machine-user",
      "--client-id",
      "machine-client",
      "--client-secret",
      "secret",
    ]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).toHaveBeenCalledTimes(2);
    expect(prompt.confirm).toHaveBeenNthCalledWith(2, {
      message: 'Update 1 other profile configured for "u@example.com" to use "machine-client"?',
      default: false,
    });
    const pfConfig = await readPlatformConfig();
    expect(pfConfig.profiles.dev?.user).toBe("machine-client");
    expect(pfConfig.profiles.qa?.user).toBe("machine-client");
    expect(pfConfig.profiles.prod?.user).toBe("other@example.com");
  });

  test("keeps current user when machine-user login targets a non-default platform profile", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "default@example.com": {
          storage: "file",
          access_token: "default-token",
          token_expires_at: "2099-01-01T00:00:00.000Z",
        },
      },
      profiles: {
        dev: {
          user: "machine-client",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: "default@example.com",
    });
    vi.mocked(fetchPlatformMachineUserToken).mockResolvedValue({
      accessToken: "dev-token",
      refreshToken: "",
      expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
    });

    const result = await runCommand(loginCommand, [
      "--profile",
      "dev",
      "--machine-user",
      "--client-id",
      "machine-client",
      "--client-secret",
      "secret",
    ]);

    expect(result.success).toBe(true);
    const pfConfig = await readPlatformConfig();
    expect(pfConfig.current_user).toBe("default@example.com");
    expect(pfConfig.users["default@example.com"]).toMatchObject({
      access_token: "default-token",
    });
    expect(pfConfig.users["https://api.dev.tailor.tech|machine-client"]).toMatchObject({
      access_token: "dev-token",
    });
  });
});
