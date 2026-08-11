import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "#/cli/shared/config-loader";
import { canPrompt, prompt } from "#/cli/shared/prompt";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { generateCommand } from "./generate";
import { loadDiff, reconstructSnapshotFromMigrations } from "./snapshot";
import { parsedType, snapshotType, writeInitialSchema } from "./test-helpers/schema-fixtures";

interface TestNamespace {
  namespace: string;
  migrationsDir: string;
  localTypes: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  namespaces: [] as TestNamespace[],
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
    tailorDBServices: state.namespaces.map((entry) => ({
      namespace: entry.namespace,
      config: {},
      typeSourceInfo: {},
      loadTypes: vi.fn().mockResolvedValue(undefined),
      processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
      get types() {
        return entry.localTypes;
      },
    })),
  })),
}));

function addNamespace(
  tmpDir: string,
  namespace: string,
  typeName: string,
  localType: ReturnType<typeof parsedType>,
): TestNamespace {
  const migrationsDir = path.join(tmpDir, namespace);
  writeInitialSchema(migrationsDir, { [typeName]: snapshotType(typeName) });
  const entry = { namespace, migrationsDir, localTypes: { [typeName]: localType } };
  state.namespaces.push(entry);
  return entry;
}

function renamedType(typeName: string, fieldName: string): ReturnType<typeof parsedType> {
  const type = parsedType(typeName);
  type.fields[fieldName] = type.fields.name!;
  delete type.fields.name;
  return type;
}

describe("tailordb migration generate with warning-tier changes", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    // A configured editor would launch for the generated migrate.ts and block
    // until the developer closes it.
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-generate-test-"));
    state.namespaces = [];
    const userWithoutName = parsedType("User");
    delete userWithoutName.fields.name;
    addNamespace(tmpDir, "tailordb", "User", userWithoutName);

    vi.mocked(loadConfig).mockImplementation(
      async () =>
        ({
          config: {
            path: path.join(tmpDir, "tailor.config.ts"),
            db: Object.fromEntries(
              state.namespaces.map(({ namespace, migrationsDir }) => [
                namespace,
                { migration: { directory: migrationsDir } },
              ]),
            ),
          },
          plugins: [],
        }) as unknown as Awaited<ReturnType<typeof loadConfig>>,
    );
    vi.mocked(canPrompt).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function generatedDiffPath(): string {
    return path.join(state.namespaces[0]!.migrationsDir, "0001", "diff.json");
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
    expect(stderr.output).toContain("--no-script --reason '<reason>'");
  });

  test("includes the active --config in the follow-up commands", async () => {
    using stderr = captureStderr();
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(generateCommand, ["--config", "custom.config.ts"]);

    expect(result.success).toBe(true);
    expect(stderr.output).toContain(
      "tailor tailordb migration script 0001 --namespace tailordb --config=custom.config.ts --no-script --reason '<reason>'",
    );
  });

  test("does not prompt with --yes", async () => {
    using stderr = captureStderr();

    const result = await runCommand(generateCommand, ["--yes"]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(loadDiff(generatedDiffPath()).scriptSkipped).toBeUndefined();
    expect(stderr.output).toContain("--no-script --reason '<reason>'");
  });

  test("does not prompt when interactive input is unavailable", async () => {
    vi.mocked(canPrompt).mockReturnValue(false);

    const result = await runCommand(generateCommand, []);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(loadDiff(generatedDiffPath()).scriptSkipped).toBeUndefined();
  });
});

describe("tailordb migration generate field rename preflight", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    // A configured editor would launch for the generated migrate.ts and block
    // until the developer closes it.
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-rename-test-"));
    state.namespaces = [];
    vi.mocked(loadConfig).mockImplementation(
      async () =>
        ({
          config: {
            path: path.join(tmpDir, "tailor.config.ts"),
            db: Object.fromEntries(
              state.namespaces.map(({ namespace, migrationsDir }) => [
                namespace,
                { migration: { directory: migrationsDir } },
              ]),
            ),
          },
          plugins: [],
        }) as unknown as Awaited<ReturnType<typeof loadConfig>>,
    );
    vi.mocked(canPrompt).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reports every unresolved namespace and writes no migration", async () => {
    const first = addNamespace(tmpDir, "tailordb", "User", renamedType("User", "displayName"));
    const second = addNamespace(tmpDir, "analyticsdb", "User", renamedType("User", "displayName"));

    const result = await runCommand(generateCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("Possible field rename(s) detected");
    expect(String(result.error)).toContain("namespace: tailordb");
    expect(String(result.error)).toContain("namespace: analyticsdb");
    expect(fs.existsSync(path.join(first.migrationsDir, "0001"))).toBe(false);
    expect(fs.existsSync(path.join(second.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects conflicting rename and drop flags before writing", async () => {
    const entry = addNamespace(tmpDir, "tailordb", "User", renamedType("User", "displayName"));

    const result = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "User.name:displayName",
      "--drop",
      "User.name",
    ]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--rename and --drop conflict for: User.name");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects an unmatched drop flag before writing", async () => {
    const entry = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));

    const result = await runCommand(generateCommand, ["--yes", "--drop", "User.missing"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--drop does not match a removed field: User.missing");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects rename and drop flags with init before deleting the baseline", async () => {
    const entry = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));
    const baselinePath = path.join(entry.migrationsDir, "0000", "schema.json");

    const result = await runCommand(generateCommand, ["--yes", "--init", "--drop", "User.name"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("cannot be used together with --init");
    expect(fs.existsSync(baselinePath)).toBe(true);
  });

  test("resolves a rename and a drop across namespaces in one run", async () => {
    const renamed = addNamespace(tmpDir, "tailordb", "User", renamedType("User", "displayName"));
    const accountWithoutName = parsedType("Account");
    delete accountWithoutName.fields.name;
    const dropped = addNamespace(tmpDir, "analyticsdb", "Account", accountWithoutName);

    const result = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "User.name:displayName",
      "--drop",
      "Account.name",
    ]);

    expect(result.success).toBe(true);
    expect(loadDiff(path.join(renamed.migrationsDir, "0001", "diff.json")).changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "field_renamed" })]),
    );
    expect(loadDiff(path.join(dropped.migrationsDir, "0001", "diff.json")).changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "field_removed" })]),
    );
  });
});

describe("tailordb migration generate with an unsupported field type change", () => {
  let tmpDir: string;

  function retypedType(typeName: string, type: string): ReturnType<typeof parsedType> {
    const parsed = parsedType(typeName);
    const field = parsed.fields.name!;
    parsed.fields.name = { ...field, config: { ...field.config, type } };
    return parsed;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-expand-test-"));
    state.namespaces = [];
    vi.mocked(loadConfig).mockImplementation(
      async () =>
        ({
          config: {
            path: path.join(tmpDir, "tailor.config.ts"),
            db: Object.fromEntries(
              state.namespaces.map(({ namespace, migrationsDir }) => [
                namespace,
                { migration: { directory: migrationsDir } },
              ]),
            ),
          },
          plugins: [],
        }) as unknown as Awaited<ReturnType<typeof loadConfig>>,
    );
    vi.mocked(canPrompt).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("still fails with the manual guidance when the conversion is not requested", async () => {
    const ns = addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));

    const result = await runCommand(generateCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("Unsupported schema changes detected");
    expect(fs.existsSync(path.join(ns.migrationsDir, "0001"))).toBe(false);
  });

  test("writes a conversion migration and a rename migration when requested", async () => {
    const ns = addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));

    const result = await runCommand(generateCommand, ["--yes", "--expand-contract", "User.name"]);

    expect(result.success).toBe(true);
    expect(loadDiff(path.join(ns.migrationsDir, "0001", "diff.json")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "field_added", fieldName: "nameMigrate" }),
        expect.objectContaining({ kind: "field_removed", fieldName: "name" }),
      ]),
    );
    expect(loadDiff(path.join(ns.migrationsDir, "0002", "diff.json")).changes).toEqual([
      expect.objectContaining({
        kind: "field_renamed",
        fieldName: "name",
        previousFieldName: "nameMigrate",
      }),
    ]);
  });

  test("scaffolds a conversion script for the first migration only", async () => {
    const ns = addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));

    await runCommand(generateCommand, ["--yes", "--expand-contract", "User.name"]);

    const expandScript = fs.readFileSync(path.join(ns.migrationsDir, "0001", "migrate.ts"), "utf8");
    const contractScript = fs.readFileSync(
      path.join(ns.migrationsDir, "0002", "migrate.ts"),
      "utf8",
    );
    expect(expandScript).toContain("convertedValue");
    expect(contractScript).not.toContain("convertedValue");
  });

  test("replays both migrations back to the declared schema", async () => {
    const ns = addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));

    await runCommand(generateCommand, ["--yes", "--expand-contract", "User.name"]);

    const replayed = reconstructSnapshotFromMigrations(ns.migrationsDir);
    expect(replayed?.types.User?.fields.name?.type).toBe("integer");
    expect(replayed?.types.User?.fields.nameMigrate).toBeUndefined();
  });

  test("rejects a flag that names a field whose type did not change", async () => {
    const ns = addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));

    const result = await runCommand(generateCommand, [
      "--yes",
      "--expand-contract",
      "User.missing",
    ]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--expand-contract does not match");
    expect(fs.existsSync(path.join(ns.migrationsDir, "0001"))).toBe(false);
  });
});
