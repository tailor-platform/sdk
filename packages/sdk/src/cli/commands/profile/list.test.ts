import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writePlatformConfig } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resetKeyringState } from "#/cli/shared/token-store";
import { listCommand } from "./list";
import { profileCommand } from ".";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-profile-list-${Date.now()}-${Math.random()}`);

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

describe("profile list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {},
      current_user: null,
    });
  });

  afterEach(() => {
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
  });

  test("with jsonMode emits an empty JSON array when no profiles exist", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });

  test("honors logger jsonMode when parent command delegates without json args", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(profileCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });

  test("includes machineUser in JSON output when profile has machine_user set", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          machine_user: "bot",
        },
      },
      current_user: null,
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    const parsed = JSON.parse(stdout.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "myprofile", machineUser: "bot" });
  });

  test("omits machineUser from JSON output when profile has no machine_user", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
        },
      },
      current_user: null,
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    const parsed = JSON.parse(stdout.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).not.toHaveProperty("machineUser");
  });

  test("includes machineUserOverride: deny when machine_user_override is set", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          machine_user: "bot",
          machine_user_override: "deny",
        },
      },
      current_user: null,
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    const parsed = JSON.parse(stdout.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ machineUser: "bot", machineUserOverride: "deny" });
  });

  test("includes machineUserOverride: allow when machine_user is set but override is absent", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        myprofile: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          machine_user: "bot",
        },
      },
      current_user: null,
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    const parsed = JSON.parse(stdout.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ machineUser: "bot", machineUserOverride: "allow" });
  });

  test("includes platform settings in JSON output when profile has them", async () => {
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
          oauth2_client_id: "dev-client",
          console_url: "https://console.dev.tailor.tech",
        },
      },
      current_user: null,
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    const parsed = JSON.parse(stdout.output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      name: "dev",
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
      consoleUrl: "https://console.dev.tailor.tech",
    });
  });
});
