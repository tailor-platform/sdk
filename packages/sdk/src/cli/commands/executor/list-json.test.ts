import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { webhookCommand } from "./webhook";
import { executorCommand } from ".";

vi.mock("#/cli/shared/client", () => ({
  fetchPaged: vi.fn(),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

describe("executor list --json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(initOperatorClient).mockResolvedValue(
      {} as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    vi.mocked(fetchPaged).mockResolvedValue([]);
  });

  test.each([
    ["executor list", executorCommand],
    ["webhook list", webhookCommand],
  ])(
    "%s honors logger jsonMode when parent command delegates without json args",
    async (_desc, command) => {
      using stdout = captureStdout();
      using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      using _json = jsonMode();

      await runCommand(command, []);

      expect(stdout.output).not.toBe("");
      expect(JSON.parse(stdout.output)).toEqual([]);
    },
  );
});
