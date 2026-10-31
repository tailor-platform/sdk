import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { commonArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { getErrorDiagnostics, withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { isCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
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
/** The same creation time half a second later, which a recorded expiry drops. */
const subSecondCreateTime = { seconds: 1_700_000_000n, nanos: 500_000_000 };

function stubClient(
  overrides: Partial<{
    getMetadata: ReturnType<typeof vi.fn>;
    setMetadata: ReturnType<typeof vi.fn>;
    createTime: typeof platformCreateTime;
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
        createTime: overrides.createTime ?? platformCreateTime,
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
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", validUUID);
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

  test("requires an organization when neither an option nor a user default gives one", async () => {
    using _logger = silenceLogger("out", "success", "warn", "error");
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", undefined);
    const client = stubClient();

    const result = await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west"]);

    expect(result).toMatchObject({
      success: false,
      error: { code: "WORKSPACE_ORGANIZATION_REQUIRED" },
    });
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });

  test("requires an organization for programmatic createWorkspace() before contacting the Platform", async () => {
    await expect(createWorkspace({ name: "test-ws", region: "us-west" })).rejects.toMatchObject({
      code: "WORKSPACE_ORGANIZATION_REQUIRED",
    });
    expect(initOperatorClient).not.toHaveBeenCalled();
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

  test("persists the explicit console URL, not the one inferred from platform_url, when the active profile also has a platform_url", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", "https://console.other.tailor.tech");
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
      console_url: "https://console.other.tailor.tech",
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
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", validUUID);
    seedConfig();
    await runTest();
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  async function runCreateJson(...extraArgs: string[]) {
    using _json = jsonMode();
    using _logger = silenceLogger("success", "warn", "info", "error");
    using outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});
    const result = await runCommand(
      createCommand,
      ["--name", "test-ws", "--region", "us-west", ...extraArgs, "--json"],
      {
        // strip unknown keys
        globalArgs: z.object(commonArgs),
      },
    );
    return { result, output: outSpy.mock.calls[0]?.[0] };
  }

  test.each(["9999999999999d", "50000000d", "4320000000001s", `${"9".repeat(400)}d`])(
    "rejects an excessive TTL %s before creating a workspace",
    async (ttl) => {
      const client = stubClient();
      const { result } = await runCreateJson("--ttl", ttl);
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("TTL must be less than 50,000,000 days");
      expect(client.createWorkspace).not.toHaveBeenCalled();
      expect(initOperatorClient).not.toHaveBeenCalled();
    },
  );

  test("validates programmatic TTL before creating a workspace", async () => {
    const client = stubClient();
    await expect(
      createWorkspace({
        name: "test-ws",
        region: "us-west",
        organizationId: validUUID,
        ttl: "9999999999999d",
      }),
    ).rejects.toThrow("TTL must be less than 50,000,000 days");
    expect(client.createWorkspace).not.toHaveBeenCalled();
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test.each(["0s", "4319999999999s"])("accepts a representable TTL %s", async (ttl) => {
    const client = stubClient();
    const { result, output } = await runCreateJson("--ttl", ttl);
    expect(result.success).toBe(true);
    expect(client.setMetadata).toHaveBeenCalledOnce();
    expect(output).toMatchObject({ ttl: { state: "written" } });
  });

  test("reports the recorded expiry in --json output", async () => {
    stubClient({ createTime: subSecondCreateTime });

    const { result, output } = await runCreateJson("--ttl", "24h");

    expect(result.success).toBe(true);
    expect(output).toMatchObject({
      id: validUUID,
      ttl: { state: "written", expiresAt: "2023-11-15T22:13:20.000Z" },
    });
  });

  test("reports an unconfirmed expiry in --json output before failing", async () => {
    stubClient({
      createTime: subSecondCreateTime,
      setMetadata: vi.fn().mockRejectedValue(new Error("permission denied")),
    });

    const { result, output } = await runCreateJson("--ttl", "24h");

    expect(output).toMatchObject({
      id: validUUID,
      ttl: { state: "unconfirmed", requestedExpiresAt: "2023-11-15T22:13:20.000Z" },
    });
    const error = result.success ? undefined : result.error;
    expect(isCLIError(error) && error.code).toBe("WORKSPACE_TTL_WRITE_FAILED");
    expect(isCLIError(error) && error.context).toMatchObject({
      requestedExpiresAt: "2023-11-15T22:13:20.000Z",
    });
  });

  test("returns the recorded expiry from programmatic createWorkspace()", async () => {
    stubClient({ createTime: subSecondCreateTime });

    const workspace = await createWorkspace({
      name: "test-ws",
      region: "us-west",
      organizationId: validUUID,
      ttl: "24h",
    });

    expect(workspace.ttl).toEqual({
      state: "written",
      expiresAt: new Date("2023-11-15T22:13:20.000Z"),
    });
  });

  test("confirms the expiry when writing it a second time succeeds", async () => {
    const client = stubClient({
      setMetadata: vi
        .fn()
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValue({}),
    });

    const { result, output } = await runCreateJson("--ttl", "24h");

    expect(result.success).toBe(true);
    expect(output).toMatchObject({ ttl: { state: "written" } });
    expect(client.setMetadata).toHaveBeenCalledTimes(2);
  });

  test("confirms an expiry whose failed write landed without writing it again", async () => {
    const client = stubClient({
      getMetadata: vi
        .fn()
        .mockResolvedValueOnce({ metadata: { labels: {} } })
        .mockResolvedValue({ metadata: { labels: { [expiresAtLabelKey]: "s-1700086400" } } }),
      setMetadata: vi.fn().mockRejectedValue(new Error("deadline exceeded")),
    });

    const { result, output } = await runCreateJson("--ttl", "24h");

    expect(result.success).toBe(true);
    expect(output).toMatchObject({ ttl: { state: "written" } });
    expect(client.setMetadata).toHaveBeenCalledTimes(1);
  });

  test("reports the expiry alongside the created profile in --json output", async () => {
    stubClient();

    const { output } = await runCreateJson(
      "--ttl",
      "24h",
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
    );

    expect(output).toMatchObject({
      ttl: { state: "written", expiresAt: "2023-11-15T22:13:20.000Z" },
      profile: { name: "bootstrap", workspaceId: validUUID },
    });
  });

  test("omits ttl from --json output when --ttl is absent", async () => {
    stubClient();

    const { output } = await runCreateJson();

    expect(output).toMatchObject({ id: validUUID });
    expect(output).not.toHaveProperty("ttl");
  });

  test("reports the recorded expiry in a message, keeping ttl out of the human-readable workspace output", async () => {
    stubClient({ createTime: subSecondCreateTime });
    using _logger = silenceLogger("success", "warn");
    using infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    using outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west", "--ttl", "24h"]);

    expect(infoSpy).toHaveBeenCalledWith("Workspace becomes prunable at 2023-11-15T22:13:20.000Z.");
    expect(outSpy.mock.calls[0]?.[0]).toMatchObject({ id: validUUID });
    expect(outSpy.mock.calls[0]?.[0]).not.toHaveProperty("ttl");
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
      args: ["workspace", "ttl", "set", "--ttl", "24h", `--workspace-id=${validUUID}`],
    });
  });

  test("keeps the run's --profile on the recovery command", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", undefined);
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {
        "u@example.com": {
          storage: "file",
          token_expires_at: "2099-12-31T00:00:00Z",
          access_token: "mock-token",
        },
      },
      profiles: { dev: { user: "u@example.com", workspace_id: validUUID } },
      current_user: null,
    });
    stubClient({ setMetadata: vi.fn().mockRejectedValue(new Error("permission denied")) });
    using _logger = silenceLogger("out", "success", "warn", "info", "error");

    const result = await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--ttl",
      "24h",
      "--profile",
      "dev",
    ]);

    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(isCLIError(error) && error.next?.args).toEqual([
      "workspace",
      "ttl",
      "set",
      "--ttl",
      "24h",
      `--workspace-id=${validUUID}`,
      "--profile=dev",
    ]);
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

describe("workspace create with user defaults", () => {
  const defaultOrganizationId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
  const defaultFolderId = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
  const otherOrganizationId = "cccccccc-3333-4ccc-8ccc-cccccccccccc";
  const profileOrganizationId = "dddddddd-4444-4ddd-8ddd-dddddddddddd";
  const envFilePath = path.join(xdgTempDir, "workspace-create.env");

  function seedUserDefaults(defaults: Record<string, string>) {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {
        "u@example.com": {
          storage: "file",
          token_expires_at: "2099-12-31T00:00:00Z",
          access_token: "mock-token",
          ...defaults,
        },
        "p@example.com": {
          storage: "file",
          token_expires_at: "2099-12-31T00:00:00Z",
          access_token: "profile-token",
          default_organization_id: profileOrganizationId,
        },
      },
      profiles: { dev: { user: "p@example.com", workspace_id: validUUID } },
      current_user: "u@example.com",
    });
  }

  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    resetKeyringState();
    for (const name of [
      "TAILOR_PLATFORM_PROFILE",
      "TAILOR_PLATFORM_TOKEN",
      "TAILOR_TOKEN",
      "TAILOR_PLATFORM_URL",
      "TAILOR_PLATFORM_ORGANIZATION_ID",
      "TAILOR_PLATFORM_FOLDER_ID",
    ]) {
      vi.stubEnv(name, undefined);
    }
    seedUserDefaults({
      default_organization_id: defaultOrganizationId,
      default_folder_id: defaultFolderId,
    });
    await runTest();
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
    if (fs.existsSync(envFilePath)) fs.rmSync(envFilePath);
  });

  async function runCreateWithDefaults(...extraArgs: string[]) {
    using _logger = silenceLogger("out", "success", "warn", "info", "error");
    return await runCommand(
      createCommand,
      ["--name", "test-ws", "--region", "us-west", ...extraArgs],
      {
        // strip unknown keys
        globalArgs: z.object(commonArgs),
      },
    );
  }

  test("creates the workspace in the user's default organization and folder", async () => {
    const client = stubClient();

    const result = await runCreateWithDefaults();

    expect(result.success).toBe(true);
    expect(client.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: defaultOrganizationId,
        folderId: defaultFolderId,
      }),
    );
  });

  test("creates the workspace directly under the default organization when no default folder is set", async () => {
    seedUserDefaults({ default_organization_id: defaultOrganizationId });
    const client = stubClient();

    await runCreateWithDefaults();

    expect(client.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: defaultOrganizationId, folderId: undefined }),
    );
  });

  test.each(["invalid region", "missing login"])(
    "does not announce creation with defaults after %s",
    async (failure) => {
      const client = stubClient();
      if (failure === "invalid region") {
        client.listAvailableWorkspaceRegions.mockResolvedValue({ regions: [] });
      } else {
        const config = await readPlatformConfig();
        config.users["u@example.com"] = {
          storage: "keyring",
          token_expires_at: "2099-12-31T00:00:00Z",
          default_organization_id: defaultOrganizationId,
          default_folder_id: defaultFolderId,
        };
        writePlatformConfig(config);
      }
      using _logger = silenceLogger("out", "success", "warn", "error");
      using infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});

      const result = await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west"]);

      expect(result.success).toBe(false);
      expect(client.createWorkspace).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Creating the workspace in"),
      );
    },
  );

  test("reports the default location it creates the workspace in", async () => {
    stubClient();
    using _logger = silenceLogger("out", "success", "warn", "error");
    using infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});

    await runCommand(createCommand, ["--name", "test-ws", "--region", "us-west"]);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `folder ${defaultFolderId} in organization ${defaultOrganizationId}, the default set by \`tailor user update\``,
      ),
    );
  });

  test.each([
    { source: "--organization-id", setUp: () => ["--organization-id", otherOrganizationId] },
    {
      source: "TAILOR_PLATFORM_ORGANIZATION_ID",
      setUp: () => {
        vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", otherOrganizationId);
        return [];
      },
    },
  ])("ignores both defaults when the organization comes from $source", async ({ setUp }) => {
    const client = stubClient();

    const result = await runCreateWithDefaults(...setUp());

    expect(result.success).toBe(true);
    expect(client.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: otherOrganizationId, folderId: undefined }),
    );
  });

  test.each([
    { source: "--folder-id", setUp: () => ["--folder-id", defaultFolderId] },
    {
      source: "TAILOR_PLATFORM_FOLDER_ID",
      setUp: () => {
        vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", defaultFolderId);
        return [];
      },
    },
  ])(
    "rejects a folder from $source without an organization instead of pairing it with the default organization",
    async ({ setUp }) => {
      stubClient();

      const result = await runCreateWithDefaults(...setUp());

      expect(result.success).toBe(false);
      const error = result.success ? undefined : result.error;
      expect(isCLIError(error) && error.code).toBe("WORKSPACE_FOLDER_WITHOUT_ORGANIZATION");
      expect(initOperatorClient).not.toHaveBeenCalled();
    },
  );

  describe.each([true, false])("--env-file with stored defaults: %s", (hasDefaults) => {
    aroundEach(async (runTest) => {
      if (!hasDefaults) seedUserDefaults({});
      await runTest();
    });

    test.each([
      {
        name: "organization",
        folder: false,
        args: [],
        organizationId: otherOrganizationId,
        folderId: undefined,
      },
      {
        name: "organization and folder",
        folder: true,
        args: [],
        organizationId: otherOrganizationId,
        folderId: defaultFolderId,
      },
      {
        name: "organization overridden by a flag",
        folder: false,
        args: ["--organization-id", profileOrganizationId],
        organizationId: profileOrganizationId,
        folderId: undefined,
      },
      {
        name: "folder overridden by a flag",
        folder: true,
        args: ["--folder-id", validUUID],
        organizationId: otherOrganizationId,
        folderId: validUUID,
      },
    ])("uses the $name from an --env-file", async ({ folder, args, organizationId, folderId }) => {
      fs.writeFileSync(
        envFilePath,
        `TAILOR_PLATFORM_ORGANIZATION_ID=${otherOrganizationId}\n${
          folder ? `TAILOR_PLATFORM_FOLDER_ID=${defaultFolderId}\n` : ""
        }`,
      );
      const client = stubClient();

      const result = await runCreateWithDefaults("--env-file", envFilePath, ...args);

      expect(result.success).toBe(true);
      expect(client.createWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId, folderId }),
      );
    });

    test("rejects a folder-only --env-file before creating a workspace", async () => {
      fs.writeFileSync(envFilePath, `TAILOR_PLATFORM_FOLDER_ID=${defaultFolderId}\n`);
      const client = stubClient();

      const result = await runCreateWithDefaults("--env-file", envFilePath);

      expect(result.success).toBe(false);
      const error = result.success ? undefined : result.error;
      expect(isCLIError(error) && error.code).toBe("WORKSPACE_FOLDER_WITHOUT_ORGANIZATION");
      expect(initOperatorClient).not.toHaveBeenCalled();
      expect(client.createWorkspace).not.toHaveBeenCalled();
    });
  });

  test.each(["TAILOR_PLATFORM_TOKEN", "TAILOR_TOKEN"])(
    "does not use the defaults when %s is set",
    async (name) => {
      vi.stubEnv(name, "mock-token");
      const client = stubClient();

      const result = await runCreateWithDefaults();

      expect(result).toMatchObject({
        success: false,
        error: { code: "WORKSPACE_ORGANIZATION_REQUIRED" },
      });
      const error = result.success ? undefined : result.error;
      expect(isCLIError(error) && error.suggestion).not.toContain("tailor user update");
      expect(client.createWorkspace).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      name: "folder",
      line: "TAILOR_PLATFORM_FOLDER_ID=",
      args: ["--organization-id", otherOrganizationId],
      expected: { organizationId: otherOrganizationId, folderId: undefined },
    },
    {
      name: "organization",
      line: "TAILOR_PLATFORM_ORGANIZATION_ID=",
      args: [],
      expected: { organizationId: defaultOrganizationId, folderId: defaultFolderId },
    },
  ])(
    "treats an empty $name line in an --env-file as not given",
    async ({ line, args, expected }) => {
      fs.writeFileSync(envFilePath, `${line}\n`);
      const client = stubClient();

      const result = await runCreateWithDefaults("--env-file", envFilePath, ...args);

      expect(result.success).toBe(true);
      expect(client.createWorkspace).toHaveBeenCalledWith(expect.objectContaining(expected));
    },
  );

  test("does not use defaults stored on a legacy user key shared with the default platform", async () => {
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    const client = stubClient();

    const result = await runCreateWithDefaults();

    expect(result).toMatchObject({
      success: false,
      error: { code: "WORKSPACE_ORGANIZATION_REQUIRED" },
    });
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });

  test.each([
    { source: "--profile", setUp: () => ["--profile", "dev"] },
    {
      source: "an --env-file",
      setUp: () => {
        fs.writeFileSync(envFilePath, "TAILOR_PLATFORM_PROFILE=dev\n");
        return ["--env-file", envFilePath];
      },
    },
  ])("uses the defaults of the profile user selected by $source", async ({ setUp }) => {
    const client = stubClient();

    await runCreateWithDefaults(...setUp());

    expect(initOperatorClient).toHaveBeenCalledWith("profile-token", undefined);
    expect(client.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: profileOrganizationId, folderId: undefined }),
    );
  });

  test.each([
    { name: "NotFound", code: Code.NotFound },
    { name: "PermissionDenied", code: Code.PermissionDenied },
  ])("points at the defaults when creating in them fails with $name", async ({ code }) => {
    const client = stubClient();
    client.createWorkspace.mockRejectedValue(
      withErrorDiagnostics(new ConnectError("not accessible", code), {
        context: { method: "CreateWorkspace" },
      }),
    );

    const result = await runCreateWithDefaults();

    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(error).toBeInstanceOf(ConnectError);
    const diagnostics = getErrorDiagnostics(error as Error);
    expect(diagnostics.suggestion).toContain("tailor user update");
    expect(diagnostics.context).toEqual({
      method: "CreateWorkspace",
      defaultOrganizationId,
      defaultFolderId,
    });
  });

  test("leaves a region lookup failure alone even when the defaults are in use", async () => {
    const client = stubClient();
    client.listAvailableWorkspaceRegions.mockRejectedValue(
      new ConnectError("denied", Code.PermissionDenied),
    );

    const result = await runCreateWithDefaults();

    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(getErrorDiagnostics(error as Error).suggestion ?? "").not.toContain("user update");
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });

  test("leaves a failure with an explicit organization alone", async () => {
    const client = stubClient();
    client.createWorkspace.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCreateWithDefaults("--organization-id", otherOrganizationId);

    expect(result.success).toBe(false);
    const error = result.success ? undefined : result.error;
    expect(getErrorDiagnostics(error as Error).suggestion ?? "").not.toContain("user update");
  });

  test("uses the same user defaults for programmatic createWorkspace()", async () => {
    const client = stubClient();

    await createWorkspace({ name: "test-ws", region: "us-west" });

    expect(client.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: defaultOrganizationId, folderId: defaultFolderId }),
    );
  });

  test("keeps an explicit programmatic organization independent of the defaults", async () => {
    const client = stubClient();

    await createWorkspace({
      name: "test-ws",
      region: "us-west",
      organizationId: otherOrganizationId,
    });

    expect(client.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: otherOrganizationId, folderId: undefined }),
    );
  });

  test("ignores user defaults for an environment-authenticated programmatic call", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "env-token");
    const client = stubClient();

    await expect(createWorkspace({ name: "test-ws", region: "us-west" })).rejects.toMatchObject({
      code: "WORKSPACE_ORGANIZATION_REQUIRED",
    });
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });

  test("rejects a programmatic folder without an organization before contacting the Platform", async () => {
    await expect(
      createWorkspace({ name: "test-ws", region: "us-west", folderId: defaultFolderId }),
    ).rejects.toMatchObject({ code: "WORKSPACE_FOLDER_WITHOUT_ORGANIZATION" });
    expect(initOperatorClient).not.toHaveBeenCalled();
  });
});
