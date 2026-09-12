import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { isCLIError } from "#/cli/shared/errors";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "#/cli/shared/token-store";
import { createCommand, createWorkspace } from "./create";
import { encodeExpiresAt, expiresAtLabelKey } from "./expiry";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-workspace-create-${Date.now()}-${Math.random()}`);

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

function seedConfig() {
  writePlatformConfig({
    version: 2,
    min_sdk_version: "1.29.0",
    users: {
      "u@example.com": {
        storage: "file",
        token_expires_at: "2099-12-31T00:00:00Z",
        access_token: "mock-token",
        refresh_token: undefined,
      },
    },
    profiles: {},
    current_user: "u@example.com",
  });
}

/** A platform creation time far from the local clock, so an expiry anchored to it is unmistakable. */
const platformCreateTime = { seconds: 1_700_000_000n, nanos: 0 };
const platformCreatedAtMs = 1_700_000_000_000;

function stubClient(
  overrides: Partial<{
    getMetadata: ReturnType<typeof vi.fn>;
    setMetadata: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const client = {
    listAvailableWorkspaceRegions: vi.fn().mockResolvedValue({ regions: ["us-west"] }),
    createWorkspace: vi.fn().mockResolvedValue({
      workspace: {
        id: validUUID,
        name: "test-ws",
        region: "us-west",
        organizationId: "organization-1",
        folderId: "folder-1",
        createTime: platformCreateTime,
      },
    }),
    getOrganizationFolder: vi.fn().mockResolvedValue({ folder: { name: "dev" } }),
    getMetadata: overrides.getMetadata ?? vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
    setMetadata: overrides.setMetadata ?? vi.fn().mockResolvedValue({}),
  };
  vi.mocked(initOperatorClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  return client;
}

aroundAll(async (runSuite) => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
  await runSuite();
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("workspace create", () => {
  aroundEach(async (runTest) => {
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "mock-token");
    seedConfig();
    stubClient();
    await runTest();
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  async function runCreate(...extraArgs: string[]) {
    using _logger = silenceLogger("out", "success", "warn");
    await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west", ...extraArgs]);
    return readPlatformConfig();
  }

  test("persists readonly: true when --permission read is combined with --profile-name", async () => {
    const config = await runCreate(
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
      "--permission",
      "read",
    );
    expect(config.profiles.bootstrap?.readonly).toBe(true);
  });

  test("validates programmatic options before initializing a client", async () => {
    await expect(createWorkspace({ name: "x", region: "us-west" })).rejects.toThrow(
      "Name must be at least 3 characters",
    );
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test("rejects an invalid --name while parsing options, before running the command", async () => {
    using _logger = silenceLogger("out", "success", "warn", "error");
    const result = await runCommand(createCommand, [
      "--name",
      "My_Workspace",
      "--region",
      "us-west",
    ]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain(
      "Name can only contain lowercase letters, numbers, and hyphens",
    );
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test("reports a too-short --name without contacting the Platform", async () => {
    using _logger = silenceLogger("out", "success", "warn", "error");
    const result = await runCommand(createCommand, ["--name", "ab", "--region", "us-west"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("Name must be at least 3 characters");
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test("accepts a valid --name through the CLI", async () => {
    using _logger = silenceLogger("out", "success", "warn");
    const result = await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west"]);

    expect(result.success).toBe(true);
    expect(initOperatorClient).toHaveBeenCalledWith("mock-token", undefined);
  });

  test("rejects an explicitly empty profile instead of falling back", async () => {
    await expect(
      createWorkspace({ name: "test-ws", region: "us-west", profile: "" }),
    ).rejects.toThrow("Profile must not be empty");
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test("omits the readonly key when --profile-name is given without --permission read", async () => {
    const config = await runCreate(
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
    );
    expect(config.profiles.bootstrap).toBeDefined();
    // We do not store readonly: false; the field should be absent so the
    // YAML output stays compatible with existing v2 configs.
    expect(config.profiles.bootstrap?.readonly).toBeUndefined();
  });

  test("creates a profile for a user whose token is scoped to TAILOR_PLATFORM_URL", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    vi.stubEnv("TAILOR_PLATFORM_OAUTH2_CLIENT_ID", "dev-client");
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", "https://console.dev.tailor.tech");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          token_expires_at: "2099-12-31T00:00:00Z",
          access_token: "custom-token",
        },
      },
      profiles: {},
      current_user: "u@example.com",
    });
    using _logger = silenceLogger("out", "success", "warn");

    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--profile-name",
      "bootstrap",
    ]);

    expect(initOperatorClient).toHaveBeenCalledWith("custom-token", undefined);
    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap).toMatchObject({
      user: "u@example.com",
      workspace_id: validUUID,
      platform_url: "https://api.dev.tailor.tech",
      oauth2_client_id: "dev-client",
      console_url: "https://console.dev.tailor.tech",
    });
  });

  test("creates a profile when the active profile selects a custom platform", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          token_expires_at: "2099-12-31T00:00:00Z",
          access_token: "custom-token",
        },
      },
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    });
    using _logger = silenceLogger("out", "success", "warn");

    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--profile-name",
      "bootstrap",
    ]);

    expect(initOperatorClient).toHaveBeenCalledWith("custom-token", {
      platformUrl: "https://api.dev.tailor.tech",
    });
    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap).toMatchObject({
      user: "u@example.com",
      workspace_id: validUUID,
      platform_url: "https://api.dev.tailor.tech",
    });
  });

  test("persists the explicit console URL, not a console-next-rewritten one, when the active profile also has a platform_url", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    vi.stubEnv("TAILOR_CONSOLE_NEXT", "1");
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", "https://console.dev.tailor.tech");
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "https://api.dev.tailor.tech|u@example.com": {
          storage: "file",
          token_expires_at: "2099-12-31T00:00:00Z",
          access_token: "custom-token",
        },
      },
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: validUUID,
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    });
    using _logger = silenceLogger("out", "success", "warn");

    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--profile-name",
      "bootstrap",
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap).toMatchObject({
      platform_url: "https://api.dev.tailor.tech",
      console_url: "https://console.dev.tailor.tech",
    });
  });

  test("creates no profile when --permission read is passed without --profile-name", async () => {
    // Matches the existing --profile-user behavior: profile-only flags are
    // silently inert when --profile-name is absent. We don't store the flag
    // anywhere because no profile was created to attach it to.
    const config = await runCreate("--permission", "read");
    expect(Object.keys(config.profiles)).toHaveLength(0);
  });
});

describe("workspace create --ttl", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "mock-token");
    seedConfig();
    await runTest();
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("records an expiry anchored to the platform's creation time, not the local clock", async () => {
    const client = stubClient();
    using _logger = silenceLogger("out", "success", "warn", "info");

    const result = await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--ttl",
      "24h",
    ]);

    expect(result.success).toBe(true);
    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: `trn:v1:workspace:${validUUID}`,
      labels: { [expiresAtLabelKey]: encodeExpiresAt(new Date(platformCreatedAtMs + 86_400_000)) },
    });
  });

  test("records no expiry when --ttl is absent", async () => {
    const client = stubClient();
    using _logger = silenceLogger("out", "success", "warn", "info");

    await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west"]);

    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("fails when the expiry write cannot be confirmed, naming the recovery command", async () => {
    stubClient({ setMetadata: vi.fn().mockRejectedValue(new Error("permission denied")) });
    using _logger = silenceLogger("out", "success", "warn", "info", "error");

    const result = await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--ttl",
      "24h",
    ]);

    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(isCLIError(error) && error.code).toBe("WORKSPACE_TTL_WRITE_FAILED");
    expect(isCLIError(error) && error.next).toEqual({
      command: "tailor",
      args: ["workspace", "ttl", "set", "--workspace-id", validUUID, "--ttl", "24h"],
    });
  });

  test("still creates the profile when the expiry write cannot be confirmed", async () => {
    stubClient({ setMetadata: vi.fn().mockRejectedValue(new Error("permission denied")) });
    using _logger = silenceLogger("out", "success", "warn", "info", "error");

    const result = await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--ttl",
      "24h",
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
    ]);

    expect(result.success).toBe(false);
    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap?.workspace_id).toBe(validUUID);
  });
});
