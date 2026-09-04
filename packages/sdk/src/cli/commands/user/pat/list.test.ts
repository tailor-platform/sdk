import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
}));

describe("user pat list", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("scoped-token");
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
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--profile", ""]);

    expect(result.success).toBe(true);
    expect(loadAccessToken).toHaveBeenCalledWith({ profile: "" });
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token");
  });

  test("prefers an explicit profile over TAILOR_PLATFORM_PROFILE", async () => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    using _json = jsonMode();

    const result = await runCommand(listCommand, ["--profile", "prod"]);

    expect(result.success).toBe(true);
    expect(loadAccessToken).toHaveBeenCalledWith({ profile: "prod" });
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token");
  });
});
