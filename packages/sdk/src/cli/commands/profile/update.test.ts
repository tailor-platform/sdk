import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { silenceLogger } from "@/cli/shared/test-helpers/silence-logger";
import { resetKeyringState } from "@/cli/shared/token-store";
import { updateCommand } from "./update";

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

vi.mock("@/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn<MockProcedure>(),
  fetchAll: vi.fn<MockProcedure>(),
}));

// Mock fetchLatestToken without disturbing readPlatformConfig / writePlatformConfig,
// which the run handler also uses and which we want to round-trip on disk.
vi.mock("@/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchLatestToken: vi.fn<MockProcedure>(),
}));

const validUUID = "12345678-1234-4abc-8def-123456789012";

beforeAll(() => {
  fs.mkdirSync(xdgTempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(xdgTempDir, { recursive: true, force: true });
});

describe("profile update --permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyringState();
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        rw: { user: "u@example.com", workspace_id: validUUID },
        ro: { user: "u@example.com", workspace_id: validUUID, readonly: true },
      },
      current_user: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Clean up the on-disk config between tests so prior writes don't leak.
    const configPath = path.join(xdgTempDir, "tailor-platform", "config.yaml");
    if (fs.existsSync(configPath)) fs.rmSync(configPath);
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
      listWorkspaces: vi.fn<MockProcedure>(),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    writePlatformConfig({
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        rw: { user: "old@example.com", workspace_id: validUUID },
      },
      current_user: null,
    });

    await runCommand(updateCommand, ["rw", "--user", "new@example.com", "--permission", "read"]);

    expect(vi.mocked(fetchLatestToken)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchLatestToken)).toHaveBeenCalledWith(expect.anything(), "new@example.com");
    expect(vi.mocked(initOperatorClient)).toHaveBeenCalledTimes(1);

    const config = await readPlatformConfig();
    expect(config.profiles.rw?.user).toBe("new@example.com");
    expect(config.profiles.rw?.readonly).toBe(true);
  });
});
