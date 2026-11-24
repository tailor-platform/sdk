import * as fs from "node:fs";
import * as os from "node:os";
import { runCommand } from "@politty/zod";
import open from "open";
import * as path from "pathe";
import { afterEach, aroundEach, describe, expect, test, vi } from "vitest";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { loadConsoleBaseUrl, loadWorkspaceId } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { brandedDefault } from "#/cli/shared/test-helpers/workspace-config";
import { openCommand } from "./open";
import type * as ConfigLoader from "#/cli/shared/config-loader";
import type { ChildProcess } from "node:child_process";

vi.mock("open", () => ({
  default: vi.fn(),
}));

vi.mock(import("#/cli/shared/config-loader"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadConfigFile: vi.fn(actual.loadConfigFile) };
});

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadConsoleBaseUrl: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function writeWorkspaceConfig(apps: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-open-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "tailor.config.ts");
  fs.writeFileSync(
    configPath,
    brandedDefault("workspace-config", `{ db: { "main-db": { files: [] } }, apps: ${apps} }`),
  );
  const actual = await vi.importActual<typeof ConfigLoader>("#/cli/shared/config-loader");
  vi.mocked(loadConfigFile).mockImplementation(actual.loadConfigFile);
  return configPath;
}

describe("open --json", () => {
  aroundEach(async (runTest) => {
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(loadConsoleBaseUrl).mockResolvedValue("https://console.tailor.tech");
    vi.mocked(loadConfigFile).mockResolvedValue({
      kind: "config",
      config: { name: "my-app" },
      plugins: [],
    } as unknown as Awaited<ReturnType<typeof loadConfigFile>>);
    vi.mocked(open).mockResolvedValue({} as ChildProcess);

    await runTest();
  });

  test.each([
    ["the browser opens", () => vi.mocked(open).mockResolvedValue({} as ChildProcess), true],
    [
      "opening the browser fails",
      () => vi.mocked(open).mockRejectedValue(new Error("browser unavailable")),
      false,
    ],
  ])("emits a parseable JSON object when %s", async (_desc, setupMock, opened) => {
    setupMock();

    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/services/applications/my-app",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "my-app",
      opened,
    });
  });

  test("uses the console URL resolved from the selected profile", async () => {
    vi.mocked(loadConsoleBaseUrl).mockResolvedValue("https://console.dev.tailor.tech");

    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openCommand, ["--profile", "dev"]);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.dev.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/services/applications/my-app",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "my-app",
      opened: true,
    });
    expect(loadConsoleBaseUrl).toHaveBeenCalledWith({ profile: "dev" });
  });

  test("allows a missing profile when the workspace ID is overridden", async () => {
    using _stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runCommand(openCommand, [
      "--profile",
      "missing",
      "--workspace-id",
      "12345678-1234-4abc-8def-123456789012",
    ]);

    expect(loadConsoleBaseUrl).toHaveBeenCalledWith({
      profile: "missing",
      allowMissingProfile: true,
    });
  });

  test("opens the application list of the workspace when the config defines several applications", async () => {
    const configPath = await writeWorkspaceConfig(
      `{ shop: { db: ["main-db"] }, backoffice: { db: ["main-db"] } }`,
    );
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openCommand, ["--config", configPath]);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/services/applications",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      opened: true,
    });
  });

  test("opens the application --app names", async () => {
    const configPath = await writeWorkspaceConfig(
      `{ shop: { db: ["main-db"] }, backoffice: { db: ["main-db"] } }`,
    );
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openCommand, ["--config", configPath, "--app", "backoffice"]);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/services/applications/backoffice",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "backoffice",
      opened: true,
    });
  });
});
