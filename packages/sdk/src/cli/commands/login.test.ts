import * as fs from "node:fs";
import { runCommand } from "politty";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchPlatformMachineUserToken } from "#/cli/shared/client";
import { writePlatformConfig } from "#/cli/shared/context";
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
  fetchPlatformMachineUserToken: vi.fn(),
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

  test("rejects machine-user login when the authenticated subject differs from the profile user", async () => {
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
  });
});
