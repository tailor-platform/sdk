import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchAll, initOperatorClient } from "#/cli/shared/client";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "#/cli/shared/token-store";
import { updateCommand } from "./update";

function writeProfiles(profiles: Parameters<typeof writePlatformConfig>[0]["profiles"]) {
  writePlatformConfig({
    version: 2,
    min_sdk_version: "1.29.0",
    users: {},
    profiles,
    current_user: null,
  });
}

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-profile-update-${Date.now()}-${Math.random()}`);

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
  fetchAll: vi.fn(),
}));

// Mock fetchLatestToken without disturbing readPlatformConfig / writePlatformConfig,
// which the run handler also uses and which we want to round-trip on disk.
vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchLatestToken: vi.fn(),
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyringState();
  vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Clean up the on-disk config between tests so prior writes don't leak.
  const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
  if (fs.existsSync(configPath)) fs.rmSync(configPath);
});

describe("profile update --permission", () => {
  beforeEach(() => {
    writeProfiles({
      rw: { user: "u@example.com", workspace_id: validUUID },
      ro: { user: "u@example.com", workspace_id: validUUID, readonly: true },
    });
  });

  test("sets readonly: true on disk and skips remote validation when only --permission read is passed", async () => {
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["rw", "--permission", "read"]);

    const config = await readPlatformConfig();
    expect(config.profiles.rw?.readonly).toBe(true);

    // Key behavioral guarantee: no token / workspace lookup happens for a
    // pure permission toggle. Otherwise users could not lift readonly when
    // their saved token has expired or the workspace has been removed.
    expect(vi.mocked(fetchLatestToken)).not.toHaveBeenCalled();
    expect(vi.mocked(initOperatorClient)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchAll)).not.toHaveBeenCalled();
  });

  test("clears readonly when --permission write is passed and skips remote validation", async () => {
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["ro", "--permission", "write"]);

    const config = await readPlatformConfig();
    // We don't store readonly: false; the field should be absent.
    expect(config.profiles.ro?.readonly).toBeUndefined();

    expect(vi.mocked(fetchLatestToken)).not.toHaveBeenCalled();
    expect(vi.mocked(initOperatorClient)).not.toHaveBeenCalled();
  });

  test("performs remote validation when --user is also passed (permission does not bypass it)", async () => {
    using _logger = silenceLogger("out", "success");
    vi.mocked(fetchLatestToken).mockResolvedValue("mock-token");
    vi.mocked(fetchAll).mockResolvedValue([{ id: validUUID }]);
    vi.mocked(initOperatorClient).mockResolvedValue({
      listWorkspaces: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    writeProfiles({
      rw: { user: "old@example.com", workspace_id: validUUID },
    });

    await runCommand(updateCommand, ["rw", "--user", "new@example.com", "--permission", "read"]);

    expect(vi.mocked(fetchLatestToken)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchLatestToken)).toHaveBeenCalledWith(
      expect.anything(),
      "new@example.com",
      undefined,
    );
    expect(vi.mocked(initOperatorClient)).toHaveBeenCalledTimes(1);

    const config = await readPlatformConfig();
    expect(config.profiles.rw?.user).toBe("new@example.com");
    expect(config.profiles.rw?.readonly).toBe(true);
  });
});

describe("profile update --machine-user", () => {
  beforeEach(() => {
    writeProfiles({
      myprofile: { user: "u@example.com", workspace_id: validUUID },
    });
  });

  test("sets machine_user on disk and skips remote validation", async () => {
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["myprofile", "--machine-user", "bot"]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.machine_user).toBe("bot");

    expect(vi.mocked(fetchLatestToken)).not.toHaveBeenCalled();
    expect(vi.mocked(initOperatorClient)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchAll)).not.toHaveBeenCalled();
  });

  test("clears machine_user when empty string is passed", async () => {
    writeProfiles({
      myprofile: { user: "u@example.com", workspace_id: validUUID, machine_user: "bot" },
    });
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["myprofile", "--machine-user", ""]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.machine_user).toBeUndefined();
  });
});

describe("profile update --platform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_URL", undefined);
    vi.stubEnv("TAILOR_PLATFORM_OAUTH2_CLIENT_ID", undefined);
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", undefined);
    vi.mocked(fetchLatestToken).mockResolvedValue("mock-token");
    vi.mocked(fetchAll).mockResolvedValue([{ id: validUUID }]);
    vi.mocked(initOperatorClient).mockResolvedValue({
      listWorkspaces: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: { user: "u@example.com", workspace_id: validUUID },
      },
      current_user: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("stores platform settings and validates the workspace against that platform", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(updateCommand, [
      "myprofile",
      "--platform-url",
      "https://api.dev.tailor.tech",
      "--oauth2-client-id",
      "dev-client",
      "--console-url",
      "https://console.dev.tailor.tech",
    ]);

    const expectedPlatformConfig = {
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
      consoleUrl: "https://console.dev.tailor.tech",
    };
    expect(vi.mocked(fetchLatestToken)).toHaveBeenCalledWith(
      expect.anything(),
      "u@example.com",
      expectedPlatformConfig,
    );
    expect(vi.mocked(initOperatorClient)).toHaveBeenCalledWith(
      "mock-token",
      expectedPlatformConfig,
    );

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile).toMatchObject({
      platform_url: "https://api.dev.tailor.tech",
      oauth2_client_id: "dev-client",
      console_url: "https://console.dev.tailor.tech",
    });
    expect(JSON.parse(stdout.output)).toMatchObject({
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
      consoleUrl: "https://console.dev.tailor.tech",
    });
  });

  test("clears platform settings when empty strings are passed", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
          oauth2_client_id: "dev-client",
          console_url: "https://console.dev.tailor.tech",
        },
      },
      current_user: null,
    });
    using _logger = silenceLogger("out", "success");

    await runCommand(updateCommand, [
      "myprofile",
      "--platform-url",
      "",
      "--oauth2-client-id",
      "",
      "--console-url",
      "",
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.platform_url).toBeUndefined();
    expect(config.profiles.myprofile?.oauth2_client_id).toBeUndefined();
    expect(config.profiles.myprofile?.console_url).toBeUndefined();
  });

  test("uses the existing platform URL for token lookup when clearing only platform-url", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
          oauth2_client_id: "dev-client",
          console_url: "https://console.dev.tailor.tech",
        },
      },
      current_user: null,
    });
    using _logger = silenceLogger("out", "success");

    await runCommand(updateCommand, ["myprofile", "--platform-url", ""]);

    expect(vi.mocked(fetchLatestToken)).toHaveBeenCalledWith(expect.anything(), "u@example.com", {
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
      consoleUrl: "https://console.dev.tailor.tech",
    });
    expect(vi.mocked(initOperatorClient)).toHaveBeenCalledWith("mock-token", {
      oauth2ClientId: "dev-client",
      consoleUrl: "https://console.dev.tailor.tech",
    });
  });

  test("rejects invalid platform URLs before writing config", async () => {
    const result = await runCommand(updateCommand, ["myprofile", "--platform-url", "not-a-url"]);

    expect(result.success).toBe(false);
    expect(vi.mocked(fetchLatestToken)).not.toHaveBeenCalled();
    expect(vi.mocked(initOperatorClient)).not.toHaveBeenCalled();

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.platform_url).toBeUndefined();
  });
});

describe("profile update --machine-user-override", () => {
  beforeEach(() => {
    writeProfiles({
      myprofile: { user: "u@example.com", workspace_id: validUUID, machine_user: "bot" },
    });
  });

  test("persists machine_user_override: deny and skips remote validation", async () => {
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["myprofile", "--machine-user-override", "deny"]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.machine_user_override).toBe("deny");

    expect(vi.mocked(fetchLatestToken)).not.toHaveBeenCalled();
    expect(vi.mocked(initOperatorClient)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchAll)).not.toHaveBeenCalled();
  });

  test("removes machine_user_override when allow is passed", async () => {
    writeProfiles({
      myprofile: {
        user: "u@example.com",
        workspace_id: validUUID,
        machine_user: "bot",
        machine_user_override: "deny",
      },
    });
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["myprofile", "--machine-user-override", "allow"]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.machine_user_override).toBeUndefined();
  });

  test("errors when deny is set with no machine user present", async () => {
    writeProfiles({
      myprofile: { user: "u@example.com", workspace_id: validUUID },
    });
    const result = await runCommand(updateCommand, [
      "myprofile",
      "--machine-user-override",
      "deny",
    ]);
    expect(result.success).toBe(false);
    expect((result as { error?: Error }).error?.message).toContain(
      "--machine-user-override deny requires --machine-user.",
    );
  });

  test("errors when machine-user is cleared while deny remains", async () => {
    writeProfiles({
      myprofile: {
        user: "u@example.com",
        workspace_id: validUUID,
        machine_user: "bot",
        machine_user_override: "deny",
      },
    });
    const result = await runCommand(updateCommand, ["myprofile", "--machine-user", ""]);
    expect(result.success).toBe(false);
    expect((result as { error?: Error }).error?.message).toContain("--machine-user-override allow");
  });

  test("clears machine_user and machine_user_override together", async () => {
    writeProfiles({
      myprofile: {
        user: "u@example.com",
        workspace_id: validUUID,
        machine_user: "bot",
        machine_user_override: "deny",
      },
    });
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, [
      "myprofile",
      "--machine-user",
      "",
      "--machine-user-override",
      "allow",
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.machine_user).toBeUndefined();
    expect(config.profiles.myprofile?.machine_user_override).toBeUndefined();
  });

  test("unrelated update succeeds when stored deny has no machine user (hand-edited config)", async () => {
    writeProfiles({
      myprofile: {
        user: "u@example.com",
        workspace_id: validUUID,
        machine_user_override: "deny",
      },
    });
    using _logger = silenceLogger("out", "success");
    await runCommand(updateCommand, ["myprofile", "--permission", "write"]);

    const config = await readPlatformConfig();
    expect(config.profiles.myprofile?.readonly).toBeUndefined();
    expect(config.profiles.myprofile?.machine_user_override).toBe("deny");
  });

  test("output includes machineUserOverride when machine_user is present", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();
    await runCommand(updateCommand, ["myprofile", "--machine-user-override", "deny"]);

    const parsed = JSON.parse(stdout.output) as Record<string, unknown>;
    expect(parsed.machineUser).toBe("bot");
    expect(parsed.machineUserOverride).toBe("deny");
  });
});
