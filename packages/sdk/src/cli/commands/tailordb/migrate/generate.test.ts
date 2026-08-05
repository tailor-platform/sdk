import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "#/cli/shared/config-loader";
import { canPrompt, prompt } from "#/cli/shared/prompt";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { generateCommand } from "./generate";
import { loadDiff } from "./snapshot";
import { parsedType, snapshotType, writeInitialSchema } from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/prompt", () => ({
  canPrompt: vi.fn(),
  prompt: { confirm: vi.fn(), text: vi.fn() },
}));

vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({
    tailorDBServices: [
      {
        namespace: "tailordb",
        config: {},
        typeSourceInfo: {},
        loadTypes: vi.fn().mockResolvedValue(undefined),
        processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
        get types() {
          return state.localTypes;
        },
      },
    ],
  })),
}));

describe("tailordb migration generate with warning-tier changes", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-generate-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    const userWithoutName = parsedType("User");
    delete userWithoutName.fields.name;
    state.localTypes = { User: userWithoutName };

    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        db: { tailordb: { migration: { directory: state.migrationsDir } } },
      },
      plugins: [],
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    vi.mocked(canPrompt).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function generatedDiffPath(): string {
    return path.join(state.migrationsDir, "0001", "diff.json");
  }

  test("records an acknowledgment when the user confirms and enters a reason", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(true);
    vi.mocked(prompt.text).mockResolvedValue("user emails are no longer needed");

    const result = await runCommand(generateCommand, []);

    expect(result.success).toBe(true);
    const diff = loadDiff(generatedDiffPath());
    expect(diff.scriptSkipped?.reason).toBe("user emails are no longer needed");
  });

  test("leaves the migration unacknowledged when the user declines", async () => {
    using stderr = captureStderr();
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(generateCommand, []);

    expect(result.success).toBe(true);
    expect(loadDiff(generatedDiffPath()).scriptSkipped).toBeUndefined();
    expect(prompt.text).not.toHaveBeenCalled();
    expect(stderr.output).toContain('--no-script --reason "..."');
  });

  test("includes the active --config in the follow-up commands", async () => {
    using stderr = captureStderr();
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(generateCommand, ["--config", "custom.config.ts"]);

    expect(result.success).toBe(true);
    expect(stderr.output).toContain(
      'tailor tailordb migration script 0001 --namespace tailordb --config=custom.config.ts --no-script --reason "..."',
    );
  });

  test("does not prompt with --yes", async () => {
    using stderr = captureStderr();

    const result = await runCommand(generateCommand, ["--yes"]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(loadDiff(generatedDiffPath()).scriptSkipped).toBeUndefined();
    expect(stderr.output).toContain('--no-script --reason "..."');
  });

  test("does not prompt when interactive input is unavailable", async () => {
    vi.mocked(canPrompt).mockReturnValue(false);

    const result = await runCommand(generateCommand, []);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(loadDiff(generatedDiffPath()).scriptSkipped).toBeUndefined();
  });
});
