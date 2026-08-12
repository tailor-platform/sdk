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
    // A configured editor would be spawned after a migrate.ts is scaffolded
    // and block the test run.
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
    // A configured editor would be spawned after a migrate.ts is scaffolded
    // and block the test run.
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
    expect(String(result.error)).toContain("Possible rename(s) detected");
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

describe("tailordb migration generate type rename preflight", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    // A configured editor would be spawned after a migrate.ts is scaffolded
    // and block the test run.
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-type-rename-test-"));
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

  function addRenamedTypeNamespace(namespace: string): TestNamespace {
    const migrationsDir = path.join(tmpDir, namespace);
    writeInitialSchema(migrationsDir, { User: snapshotType("User") });
    const person = parsedType("Person");
    const entry = { namespace, migrationsDir, localTypes: { Person: person } };
    state.namespaces.push(entry);
    return entry;
  }

  test("fails on an unresolved type rename candidate and writes no migration", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("Possible rename(s) detected");
    expect(String(result.error)).toContain("- User → Person? (namespace: tailordb)");
    expect(String(result.error)).toContain('--rename "OldType:NewType"');
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("records a type_renamed change with --rename Old:New", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, ["--yes", "--rename", "User:Person"]);

    expect(result.success).toBe(true);
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.changes).toEqual([
      expect.objectContaining({
        kind: "table_renamed",
        typeName: "Person",
        previousTypeName: "User",
      }),
    ]);
    expect(diff.requiresMigrationScript).toBe(true);
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001", "migrate.ts"))).toBe(true);
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001", "db.ts"))).toBe(true);
  });

  test("confirms a type removal with --drop Type", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, ["--yes", "--drop", "User"]);

    expect(result.success).toBe(true);
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.changes.map((c) => c.kind).toSorted()).toEqual(["table_added", "table_removed"]);
    expect(diff.requiresMigrationScript).toBe(false);
  });

  test("rejects conflicting type rename and drop flags before writing", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "User:Person",
      "--drop",
      "User",
    ]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--rename and --drop conflict for: User");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects an unmatched type rename flag before writing", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, ["--yes", "--rename", "Ghost:Person"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain(
      "--rename does not match a removed + added type pair: Ghost:Person",
    );
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects an unmatched type drop flag before writing", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, ["--yes", "--drop", "Ghost"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--drop does not match a removed type: Ghost");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });
});
