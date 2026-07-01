import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses the active profile platform when loading the current user's token", async () => {
    const config = {
      version: 2,
      min_sdk_version: "1.29.0",
      users: {},
      profiles: {
        dev: {
          user: "u@example.com",
          workspace_id: "12345678-1234-4abc-8def-123456789012",
          platform_url: "https://api.dev.tailor.tech",
        },
      },
      current_user: null,
    } as unknown as Awaited<ReturnType<typeof readPlatformConfig>>;
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    vi.mocked(readPlatformConfig).mockResolvedValue(config);
    using _json = jsonMode();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(fetchLatestToken).toHaveBeenCalledWith(config, "u@example.com", {
      platformUrl: "https://api.dev.tailor.tech",
    });
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token", {
      platformUrl: "https://api.dev.tailor.tech",
    });
  });
});
