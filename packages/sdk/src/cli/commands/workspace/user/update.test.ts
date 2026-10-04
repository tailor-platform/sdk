import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { updateCommand } from "./update";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

describe("workspace user update", () => {
  test("prints the user, role, and workspace under JSON output", async () => {
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client: { updateWorkspacePlatformUser: vi.fn().mockResolvedValue({}) },
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    using _json = jsonMode();
    using _logger = silenceLogger("success");
    using stdout = captureStdout();

    const result = await runCommand(updateCommand, [
      "--email",
      "user@example.com",
      "--role",
      "editor",
    ]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      workspaceId: "workspace-1",
      email: "user@example.com",
      role: "editor",
    });
  });
});
