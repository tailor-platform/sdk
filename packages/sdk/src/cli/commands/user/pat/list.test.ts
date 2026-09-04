import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { fetchLatestToken, readPlatformConfig } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchLatestToken: vi.fn(),
  readPlatformConfig: vi.fn(),
}));

describe("user pat list", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(fetchLatestToken).mockResolvedValue({
      accessToken: "scoped-token",
      user: "u@example.com",
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      listPersonalAccessTokens: vi.fn().mockResolvedValue({
        personalAccessTokens: [],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    await runTest();
    vi.unstubAllEnvs();
  });

  test("an empty explicit profile falls back to the environment profile", async () => {
    const config = {
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    } satisfies Awaited<ReturnType<typeof readPlatformConfig>>;
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    vi.mocked(readPlatformConfig).mockResolvedValue(config);
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--profile", ""]);

    expect(result.success).toBe(true);
    expect(fetchLatestToken).toHaveBeenCalledWith(config, "u@example.com", {
      platformUrl: "https://api.dev.tailor.tech",
    });
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token", {
      platformUrl: "https://api.dev.tailor.tech",
    });
  });

  test("prefers an explicit profile over TAILOR_PLATFORM_PROFILE", async () => {
    const config = {
      version: 3,
      min_sdk_version: "2.0.0",
      users: {},
      profiles: {
        dev: { user: "dev@example.com", workspace_id: "12345678-1234-4abc-8def-123456789012" },
        prod: {
          user: "prod@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.prod.tailor.tech",
        },
      },
      current_user: null,
    } satisfies Awaited<ReturnType<typeof readPlatformConfig>>;
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    vi.mocked(readPlatformConfig).mockResolvedValue(config);
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--profile", "prod"]);

    expect(result.success).toBe(true);
    expect(fetchLatestToken).toHaveBeenCalledWith(config, "prod@example.com", {
      platformUrl: "https://api.prod.tailor.tech",
    });
  });
});
