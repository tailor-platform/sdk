import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { inviteCommand } from "./invite";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

describe("workspace user invite", () => {
  test("prints the user, role, and workspace under JSON output", async () => {
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client: { inviteWorkspacePlatformUser: vi.fn().mockResolvedValue({}) },
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    using _json = jsonMode();
    using _logger = silenceLogger("success");
    using stdout = captureStdout();

    const result = await runCommand(inviteCommand, [
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
