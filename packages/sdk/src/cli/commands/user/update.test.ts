import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { isCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "#/cli/shared/token-store";
import { updateCommand } from "./update";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-user-update-${Date.now()}-${Math.random()}`);

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

const organizationId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const folderId = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const otherOrganizationId = "cccccccc-3333-4ccc-8ccc-cccccccccccc";
const workspaceId = "12345678-1234-4abc-8def-123456789012";
const devPlatformUrl = "https://api.dev.tailor.tech";

function fileUser(fields: Record<string, string> = {}) {
  return {
    storage: "file" as const,
    access_token: "token",
    token_expires_at: "2999-01-01T00:00:00.000Z",
    ...fields,
  };
}

function seedConfig(defaults: Record<string, string> = {}) {
  writePlatformConfig({
    version: 3,
    min_sdk_version: "2.0.0",
    users: {
      "platform-user-sub": fileUser({ email: "user@example.com", ...defaults }),
      [`${devPlatformUrl}|dev-user-sub`]: fileUser(),
    },
    profiles: {
      dev: { user: "dev-user-sub", workspace_id: workspaceId, platform_url: devPlatformUrl },
    },
    current_user: "platform-user-sub",
  });
}

async function runUpdate(...args: string[]) {
  using _logger = silenceLogger("success", "warn", "error");
  return await runCommand(updateCommand, args);
}

function errorCode(result: Awaited<ReturnType<typeof runUpdate>>) {
  const error = result.success ? undefined : result.error;
  return isCLIError(error) ? error.code : String(error);
}

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("user update", () => {
  beforeEach(() => {
    resetKeyringState();
    for (const name of [
      "TAILOR_PLATFORM_PROFILE",
      "TAILOR_PLATFORM_URL",
      "TAILOR_PLATFORM_TOKEN",
      "TAILOR_TOKEN",
      "TAILOR_PLATFORM_ORGANIZATION_ID",
      "TAILOR_PLATFORM_FOLDER_ID",
    ]) {
      vi.stubEnv(name, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("stores the default organization and folder on the current user", async () => {
    seedConfig();

    const result = await runUpdate("-o", organizationId, "-f", folderId);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.users["platform-user-sub"]).toMatchObject({
      default_organization_id: organizationId,
      default_folder_id: folderId,
    });
  });

  test("replaces both defaults, clearing the folder, when only an organization is given", async () => {
    seedConfig({ default_organization_id: organizationId, default_folder_id: folderId });

    const result = await runUpdate("--default-organization-id", otherOrganizationId);

    expect(result.success).toBe(true);
    const user = (await readPlatformConfig()).users["platform-user-sub"];
    expect(user?.default_organization_id).toBe(otherOrganizationId);
    expect(user).not.toHaveProperty("default_folder_id");
  });

  test("clears both defaults when the organization is an empty string", async () => {
    seedConfig({ default_organization_id: organizationId, default_folder_id: folderId });

    const result = await runUpdate("--default-organization-id", "");

    expect(result.success).toBe(true);
    const user = (await readPlatformConfig()).users["platform-user-sub"];
    expect(user).not.toHaveProperty("default_organization_id");
    expect(user).not.toHaveProperty("default_folder_id");
  });

  test.each([
    { name: "a folder without an organization", args: ["-f", folderId] },
    { name: "a folder with a cleared organization", args: ["-o", "", "-f", folderId] },
  ])("rejects $name and leaves the defaults unchanged", async ({ args }) => {
    seedConfig({ default_organization_id: organizationId });

    const result = await runUpdate(...args);

    expect(errorCode(result)).toBe("USER_DEFAULT_FOLDER_WITHOUT_ORGANIZATION");
    const user = (await readPlatformConfig()).users["platform-user-sub"];
    expect(user?.default_organization_id).toBe(organizationId);
    expect(user).not.toHaveProperty("default_folder_id");
  });

  test("requires at least one setting", async () => {
    seedConfig();

    const result = await runUpdate();

    expect(errorCode(result)).toBe("USER_UPDATE_EMPTY");
  });

  test.each([
    { name: "organization", args: ["-o", "not-a-uuid"] },
    { name: "folder", args: ["-o", organizationId, "-f", "not-a-uuid"] },
  ])("rejects a default $name that is not a UUID", async ({ args }) => {
    seedConfig();

    const result = await runUpdate(...args);

    expect(result.success).toBe(false);
    expect((await readPlatformConfig()).users["platform-user-sub"]).not.toHaveProperty(
      "default_organization_id",
    );
  });

  test("updates the profile's user on the profile's platform", async () => {
    seedConfig();

    const result = await runUpdate("--profile", "dev", "-o", organizationId);

    expect(result.success).toBe(true);
    const config = await readPlatformConfig();
    expect(config.users[`${devPlatformUrl}|dev-user-sub`]?.default_organization_id).toBe(
      organizationId,
    );
    expect(config.users["platform-user-sub"]).not.toHaveProperty("default_organization_id");
  });

  test("does not write a platform's defaults onto a legacy user key shared with the default platform", async () => {
    vi.stubEnv("TAILOR_PLATFORM_URL", devPlatformUrl);
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: { "legacy-user": fileUser() },
      profiles: {},
      current_user: "legacy-user",
    });

    const result = await runUpdate("-o", organizationId);

    expect(errorCode(result)).toBe("USER_NOT_FOUND");
    expect((await readPlatformConfig()).users["legacy-user"]).not.toHaveProperty(
      "default_organization_id",
    );
  });

  test("reports a missing current user", async () => {
    writePlatformConfig({
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: {},
      current_user: null,
    });

    expect(errorCode(await runUpdate("-o", organizationId))).toBe("USER_NOT_SET");
  });

  test("reports a missing profile", async () => {
    seedConfig();

    expect(errorCode(await runUpdate("--profile", "missing", "-o", organizationId))).toBe(
      "PROFILE_NOT_FOUND",
    );
  });

  test.each([
    {
      name: "a new pair",
      seed: {} as Record<string, string>,
      args: ["-o", organizationId, "-f", folderId],
      expected: { changed: true, defaultOrganizationId: organizationId, defaultFolderId: folderId },
    },
    {
      name: "the stored pair",
      seed: { default_organization_id: organizationId, default_folder_id: folderId },
      args: ["-o", organizationId, "-f", folderId],
      expected: {
        changed: false,
        defaultOrganizationId: organizationId,
        defaultFolderId: folderId,
      },
    },
    {
      name: "a clear",
      seed: { default_organization_id: organizationId },
      args: ["-o", ""],
      expected: { changed: true, defaultOrganizationId: null, defaultFolderId: null },
    },
  ])(
    "prints the resulting defaults for $name under JSON output",
    async ({ seed, args, expected }) => {
      seedConfig(seed);
      using _json = jsonMode();
      using stdout = captureStdout();

      const result = await runUpdate(...args);

      expect(result.success).toBe(true);
      expect(JSON.parse(stdout.output)).toEqual({
        ...expected,
        user: "platform-user-sub",
        profile: null,
      });
    },
  );

  test("warns that the defaults are not used while TAILOR_PLATFORM_TOKEN is set", async () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "env-token");
    seedConfig();
    using _success = silenceLogger("success");
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await runCommand(updateCommand, ["-o", organizationId]);

    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TAILOR_PLATFORM_TOKEN"));
  });
});
