import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { readPlatformConfig } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { deleteCommand } from "./delete";

vi.mock("#/cli/shared/context", () => ({
  readPlatformConfig: vi.fn(),
  writePlatformConfig: vi.fn(),
}));

describe("profile delete", () => {
  test("prints the deleted profile under JSON output", async () => {
    vi.mocked(readPlatformConfig).mockResolvedValue({
      profiles: { dev: { user: "u@example.com", workspace_id: "workspace-1" } },
    } as unknown as Awaited<ReturnType<typeof readPlatformConfig>>);
    using _json = jsonMode();
    using _logger = silenceLogger("success");
    using stdout = captureStdout();

    const result = await runCommand(deleteCommand, ["dev"]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({ changed: true, name: "dev" });
  });
});
