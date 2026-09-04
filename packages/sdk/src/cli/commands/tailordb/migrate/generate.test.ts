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
  tableName: string,
  localType: ReturnType<typeof parsedType>,
): TestNamespace {
  const migrationsDir = path.join(tmpDir, namespace);
  writeInitialSchema(migrationsDir, { [tableName]: snapshotType(tableName) });
  const entry = { namespace, migrationsDir, localTypes: { [tableName]: localType } };
  state.namespaces.push(entry);
  return entry;
}

function renamedType(tableName: string, fieldName: string): ReturnType<typeof parsedType> {
  const type = parsedType(tableName);
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

describe("tailordb migration generate with an unsupported field type change", () => {
  let tmpDir: string;

  function retypedType(tableName: string, type: string): ReturnType<typeof parsedType> {
    const parsed = parsedType(tableName);
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

  test("names the flag that would convert the field", async () => {
    using stderr = captureStderr();
    addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));

    await runCommand(generateCommand, ["--yes"]);

    expect(stderr.output).toContain('--expand-contract "User.name"');
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
    expect(replayed?.tables.User?.fields.name?.type).toBe("integer");
    expect(replayed?.tables.User?.fields.nameMigrate).toBeUndefined();
  });

  test("keeps an unrelated change out of the conversion migration", async () => {
    const withExtra = retypedType("User", "integer");
    withExtra.fields.nickname = {
      name: "nickname",
      config: { type: "string", required: false },
    };
    const ns = addNamespace(tmpDir, "tailordb", "User", withExtra);

    await runCommand(generateCommand, ["--yes", "--expand-contract", "User.name"]);

    const expand = loadDiff(path.join(ns.migrationsDir, "0001", "diff.json"));
    const contract = loadDiff(path.join(ns.migrationsDir, "0002", "diff.json"));
    const added = (diff: typeof expand) =>
      diff.changes.filter((change) => change.kind === "field_added").map((c) => c.fieldName);

    expect(added(expand)).toEqual(["nameMigrate"]);
    expect(added(contract)).toContain("nickname");
  });

  test("converts only the namespace whose field changed", async () => {
    const converted = addNamespace(tmpDir, "tailordb", "User", retypedType("User", "integer"));
    const untouched = addNamespace(tmpDir, "analyticsdb", "User", parsedType("User"));

    const result = await runCommand(generateCommand, ["--yes", "--expand-contract", "User.name"]);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(converted.migrationsDir, "0002"))).toBe(true);
    expect(fs.existsSync(path.join(untouched.migrationsDir, "0001"))).toBe(false);
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

  test("rejects an ineligible field with its reason before writing", async () => {
    const retyped = retypedType("User", "integer");
    retyped.fields.name!.config.unique = true;
    const ns = addNamespace(tmpDir, "tailordb", "User", retyped);

    const result = await runCommand(generateCommand, ["--yes", "--expand-contract", "User.name"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain(
      "--expand-contract cannot convert User.name (namespace: tailordb): the field is unique",
    );
    expect(String(result.error)).not.toContain("Unsupported schema changes detected");
    expect(fs.existsSync(path.join(ns.migrationsDir, "0001"))).toBe(false);
  });

  test("preserves confirmed field and type renames in the contract migration", async () => {
    const migrationsDir = path.join(tmpDir, "tailordb");
    writeInitialSchema(migrationsDir, {
      Account: snapshotType("Account"),
      Product: snapshotType("Product"),
      User: snapshotType("User"),
    });
    state.namespaces.push({
      namespace: "tailordb",
      migrationsDir,
      localTypes: {
        Account: renamedType("Account", "displayName"),
        Person: parsedType("Person"),
        Product: retypedType("Product", "boolean"),
      },
    });

    const result = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "Account.name:displayName",
      "--rename",
      "User:Person",
      "--expand-contract",
      "Product.name",
    ]);

    expect(result.success).toBe(true);
    expect(loadDiff(path.join(migrationsDir, "0002", "diff.json")).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "field_renamed",
          tableName: "Account",
          previousFieldName: "name",
          fieldName: "displayName",
        }),
        expect.objectContaining({
          kind: "table_renamed",
          previousTableName: "User",
          tableName: "Person",
        }),
        expect.objectContaining({
          kind: "field_renamed",
          tableName: "Product",
          previousFieldName: "nameMigrate",
          fieldName: "name",
        }),
      ]),
    );
    const contractScript = fs.readFileSync(path.join(migrationsDir, "0002", "migrate.ts"), "utf8");
    expect(contractScript).toContain('.updateTable("Account")');
    expect(contractScript).toContain('displayName: eb.ref("name")');
    expect(contractScript).toContain('.selectFrom("User")');
    expect(contractScript).toContain('.insertInto("Person")');
  });
});

describe("tailordb migration generate nested member rename preflight", () => {
  let tmpDir: string;

  function nestedType(memberName: string): ReturnType<typeof parsedType> {
    const type = parsedType("User");
    type.fields.address = {
      name: "address",
      config: {
        type: "nested",
        required: false,
        fields: { [memberName]: { type: "string", required: false } },
      },
    };
    return type;
  }

  function addNestedNamespace(namespace: string, localMemberName: string): TestNamespace {
    const migrationsDir = path.join(tmpDir, namespace);
    const baseline = snapshotType("User");
    baseline.fields.address = {
      type: "nested",
      required: false,
      fields: { zip: { type: "string", required: false } },
    };
    writeInitialSchema(migrationsDir, { User: baseline });
    const entry = {
      namespace,
      migrationsDir,
      localTypes: { User: nestedType(localMemberName) },
    };
    state.namespaces.push(entry);
    return entry;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-nested-rename-test-"));
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

  test("fails on an unresolved nested member rename candidate and writes no migration", async () => {
    const entry = addNestedNamespace("tailordb", "zipCode");

    const result = await runCommand(generateCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("Possible rename(s) detected");
    expect(String(result.error)).toContain("User.address.zip → zipCode?");
    expect(String(result.error)).toContain('"Table.field.oldMember:newMember"');
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("records the rename and scaffolds a copy script with --rename Table.field.old:new", async () => {
    const entry = addNestedNamespace("tailordb", "zipCode");

    const result = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "User.address.zip:zipCode",
    ]);

    expect(result.success).toBe(true);
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.changes).toEqual([
      expect.objectContaining({
        kind: "field_modified",
        fieldName: "address",
        memberRenames: [{ previousPath: ["zip"], path: ["zipCode"] }],
      }),
    ]);
    expect(diff.requiresMigrationScript).toBe(true);
    expect(diff.warnings).toEqual([]);
    const script = fs.readFileSync(path.join(entry.migrationsDir, "0001", "migrate.ts"), "utf-8");
    expect(script).toContain('renameNestedMember(address, ["zip"], "zipCode")');
  });

  test("keeps the removal warning with --drop Table.field.member", async () => {
    const entry = addNestedNamespace("tailordb", "zipCode");

    const result = await runCommand(generateCommand, ["--yes", "--drop", "User.address.zip"]);

    expect(result.success).toBe(true);
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.changes[0]).not.toHaveProperty("memberRenames");
    expect(diff.requiresMigrationScript).toBe(false);
    expect(diff.warnings.map((w) => w.fieldName)).toEqual(["address.zip"]);
  });

  test("confirms the rename interactively", async () => {
    const entry = addNestedNamespace("tailordb", "zipCode");
    vi.mocked(canPrompt).mockReturnValue(true);
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    const result = await runCommand(generateCommand, []);

    expect(result.success).toBe(true);
    expect(prompt.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("User.address.zip was removed and zipCode was added"),
      }),
    );
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.changes[0]).toMatchObject({
      memberRenames: [{ previousPath: ["zip"], path: ["zipCode"] }],
    });
  });

  test("rejects conflicting nested rename and drop flags before writing", async () => {
    const entry = addNestedNamespace("tailordb", "zipCode");

    const result = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "User.address.zip:zipCode",
      "--drop",
      "User.address.zip",
    ]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--rename and --drop conflict for: User.address.zip");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects unmatched nested flags before writing", async () => {
    const entry = addNestedNamespace("tailordb", "zipCode");

    const renameResult = await runCommand(generateCommand, [
      "--yes",
      "--rename",
      "User.address.fax:zipCode",
    ]);
    const dropResult = await runCommand(generateCommand, ["--yes", "--drop", "User.address.fax"]);

    expect(String(renameResult.error)).toContain(
      "--rename does not match a removed + added nested member pair: User.address.fax:zipCode",
    );
    expect(String(dropResult.error)).toContain(
      "--drop does not match a removed nested member: User.address.fax",
    );
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
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
    expect(String(result.error)).toContain('--rename "OldTable:NewTable"');
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
        tableName: "Person",
        previousTableName: "User",
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
      "--rename does not match a removed + added table pair: Ghost:Person",
    );
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects an unmatched type drop flag before writing", async () => {
    const entry = addRenamedTypeNamespace("tailordb");

    const result = await runCommand(generateCommand, ["--yes", "--drop", "Ghost"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--drop does not match a removed table: Ghost");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });
});

describe("tailordb migration generate --data-only", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    // A configured editor would be spawned after a migrate.ts is scaffolded
    // and block the test run.
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-data-only-test-"));
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

  test("creates a script-only migration when the schema is unchanged", async () => {
    const entry = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));

    const result = await runCommand(generateCommand, ["--data-only", "--yes"]);

    expect(result.success).toBe(true);
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.changes).toEqual([]);
    expect(diff.requiresMigrationScript).toBe(true);
    const script = fs.readFileSync(path.join(entry.migrationsDir, "0001", "migrate.ts"), "utf8");
    expect(script).toContain("export async function main(trx: Transaction)");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001", "db.ts"))).toBe(true);
    const replayed = reconstructSnapshotFromMigrations(entry.migrationsDir);
    expect(replayed?.tables.User?.fields.name?.type).toBe("string");
  });

  test("records the --name description in the diff", async () => {
    const entry = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));

    const result = await runCommand(generateCommand, [
      "--data-only",
      "--yes",
      "--name",
      "backfill user names",
    ]);

    expect(result.success).toBe(true);
    const diff = loadDiff(path.join(entry.migrationsDir, "0001", "diff.json"));
    expect(diff.description).toBe("backfill user names");
  });

  test("fails when the namespace has pending schema changes", async () => {
    const userWithoutName = parsedType("User");
    delete userWithoutName.fields.name;
    const entry = addNamespace(tmpDir, "tailordb", "User", userWithoutName);

    const result = await runCommand(generateCommand, ["--data-only", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("schema changes");
    expect(String(result.error)).toContain("--data-only");
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("fails when the namespace has no migration baseline", async () => {
    const migrationsDir = path.join(tmpDir, "tailordb");
    state.namespaces.push({
      namespace: "tailordb",
      migrationsDir,
      localTypes: { User: parsedType("User") },
    });

    const result = await runCommand(generateCommand, ["--data-only", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("initial snapshot");
    expect(fs.existsSync(path.join(migrationsDir, "0000"))).toBe(false);
  });

  test("rejects schema-change flags combined with --data-only", async () => {
    const entry = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));

    for (const flags of [
      ["--init"],
      ["--rename", "User.name:displayName"],
      ["--drop", "User.name"],
      ["--expand-contract", "User.name"],
    ]) {
      const result = await runCommand(generateCommand, ["--data-only", "--yes", ...flags]);

      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("cannot be used together with --data-only");
    }
    expect(fs.existsSync(path.join(entry.migrationsDir, "0001"))).toBe(false);
  });

  test("requires --namespace when multiple namespaces are configured", async () => {
    const first = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));
    const second = addNamespace(tmpDir, "analyticsdb", "Account", parsedType("Account"));

    const result = await runCommand(generateCommand, ["--data-only", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("--namespace");
    expect(fs.existsSync(path.join(first.migrationsDir, "0001"))).toBe(false);
    expect(fs.existsSync(path.join(second.migrationsDir, "0001"))).toBe(false);
  });

  test("targets only the namespace named by --namespace", async () => {
    const untouched = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));
    const targeted = addNamespace(tmpDir, "analyticsdb", "Account", parsedType("Account"));

    const result = await runCommand(generateCommand, [
      "--data-only",
      "--yes",
      "--namespace",
      "analyticsdb",
    ]);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(targeted.migrationsDir, "0001", "migrate.ts"))).toBe(true);
    expect(fs.existsSync(path.join(untouched.migrationsDir, "0001"))).toBe(false);
  });

  test("ignores invalid migration files outside the target namespace", async () => {
    const unrelated = addNamespace(tmpDir, "tailordb", "User", parsedType("User"));
    const targeted = addNamespace(tmpDir, "analyticsdb", "Account", parsedType("Account"));
    fs.writeFileSync(path.join(unrelated.migrationsDir, "0000", "schema.json"), "{");

    const result = await runCommand(generateCommand, [
      "--data-only",
      "--yes",
      "--namespace",
      "analyticsdb",
    ]);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(targeted.migrationsDir, "0001", "migrate.ts"))).toBe(true);
    expect(fs.existsSync(path.join(unrelated.migrationsDir, "0001"))).toBe(false);
  });

  test("rejects --namespace without --data-only", async () => {
    addNamespace(tmpDir, "tailordb", "User", parsedType("User"));

    const result = await runCommand(generateCommand, ["--yes", "--namespace", "tailordb"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain(
      "--namespace can only be used together with --data-only",
    );
  });
});
