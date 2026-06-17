import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "@/cli/shared/client";
import { readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { silenceLogger } from "@/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "@/cli/shared/token-store";
import { createCommand } from "./create";

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

vi.mock("@/cli/shared/client", async (importOriginal) => ({
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

function seedV3Config() {
  writePlatformConfig({
    version: 3,
    min_sdk_version: "2.0.0",
    users: {
      "user-subject-1": {
        storage: "file",
        token_expires_at: "2099-12-31T00:00:00Z",
        access_token: "mock-token",
        refresh_token: undefined,
        email: "u@example.com",
      },
    },
    profiles: {},
    current_user: "user-subject-1",
  });
}

function stubClient() {
  vi.mocked(initOperatorClient).mockResolvedValue({
    listAvailableWorkspaceRegions: vi.fn().mockResolvedValue({ regions: ["us-west"] }),
    createWorkspace: vi.fn().mockResolvedValue({
      workspace: {
        id: validUUID,
        name: "test-ws",
        region: "us-west",
        organizationId: "organization-1",
        folderId: "folder-1",
        createdAt: { seconds: 0n, nanos: 0 },
      },
    }),
    getOrganizationFolder: vi.fn().mockResolvedValue({ folder: { name: "dev" } }),
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
}

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("workspace create --permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "mock-token");
    seedConfig();
    stubClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Clean up the on-disk config between tests so prior writes don't leak.
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("persists readonly: true when --permission read is combined with --profile-name", async () => {
    using _logger = silenceLogger("out", "success", "warn");
    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
      "--permission",
      "read",
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap?.readonly).toBe(true);
  });

  test("omits the readonly key when --profile-name is given without --permission read", async () => {
    using _logger = silenceLogger("out", "success", "warn");
    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap).toBeDefined();
    // We do not store readonly: false; the field should be absent so the
    // YAML output stays compatible with existing v2 configs.
    expect(config.profiles.bootstrap?.readonly).toBeUndefined();
  });

  test("stores the resolved user key when --profile-user is an email in v3 config", async () => {
    seedV3Config();
    using _logger = silenceLogger("out", "success", "warn");
    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--profile-name",
      "bootstrap",
      "--profile-user",
      "u@example.com",
    ]);

    const config = await readPlatformConfig();
    expect(config.profiles.bootstrap?.user).toBe("user-subject-1");
  });

  test("creates no profile when --permission read is passed without --profile-name", async () => {
    using _logger = silenceLogger("out", "success", "warn");
    // Matches the existing --profile-user behavior: profile-only flags are
    // silently inert when --profile-name is absent. We don't store the flag
    // anywhere because no profile was created to attach it to.
    await runCommand(createCommand, [
      "--name",
      "test-ws",
      "--region",
      "us-west",
      "--permission",
      "read",
    ]);

    const config = await readPlatformConfig();
    expect(Object.keys(config.profiles)).toHaveLength(0);
  });
});
