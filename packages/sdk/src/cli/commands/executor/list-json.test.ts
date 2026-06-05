import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { fetchPaged, initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { webhookCommand } from "./webhook";
import { executorCommand } from ".";

vi.mock("@/cli/shared/client", () => ({
  fetchPaged: vi.fn<MockProcedure>(),
  initOperatorClient: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn<MockProcedure>(),
  loadWorkspaceId: vi.fn<MockProcedure>(),
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

  test("honors logger jsonMode when parent command delegates without json args", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(executorCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });

  test("webhook list honors logger jsonMode when parent command delegates without json args", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(webhookCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });
});
