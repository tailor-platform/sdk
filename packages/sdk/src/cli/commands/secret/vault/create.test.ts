import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { createCommand } from "./create";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

describe("secret vault create", () => {
  test.each([
    ["positionally", ["api-keys"]],
    ["by option name", ["--name", "api-keys"]],
  ])("prints the created vault under JSON output when named %s", async (_, argv) => {
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client: { createSecretManagerVault: vi.fn().mockResolvedValue({}) },
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    using _json = jsonMode();
    using _logger = silenceLogger("success");
    using stdout = captureStdout();

    const result = await runCommand(createCommand, argv);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      workspaceId: "workspace-1",
      name: "api-keys",
    });
  });
});
