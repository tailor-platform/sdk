import open from "open";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadWorkspaceId } from "@/cli/shared/context";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { openCommand } from "./open";

vi.mock("open", () => ({
  default: vi.fn(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("@/cli/shared/context", () => ({
  loadWorkspaceId: vi.fn(),
}));

function captureStdout() {
  let output = "";
  const spy = vi.spyOn(console, "log").mockImplementation((chunk) => {
    output += String(chunk);
  });

  return {
    get output() {
      return output;
    },
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}

describe("open --json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    vi.mocked(open).mockResolvedValue(undefined as never);
  });

  test("emits a parseable JSON object when the browser opens", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await openCommand.run({
      json: true,
      "workspace-id": undefined,
      profile: undefined,
      config: "tailor.config.ts",
    } as never);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/applications/my-app/overview",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "my-app",
      opened: true,
    });
  });

  test("emits a parseable JSON object when opening the browser fails", async () => {
    vi.mocked(open).mockRejectedValue(new Error("browser unavailable"));

    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await openCommand.run({
      json: true,
      "workspace-id": undefined,
      profile: undefined,
      config: "tailor.config.ts",
    } as never);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/applications/my-app/overview",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "my-app",
      opened: false,
    });
  });
});
