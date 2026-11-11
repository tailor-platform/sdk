import * as fs from "node:fs";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { runMigrationTest } from "./test";
import {
  remoteType,
  snapshotType,
  writeDiff,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";
import { createMigrationTestDependencies } from "./test-runtime";
import type { MigrationTestOptions } from "./test-types";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn().mockResolvedValue("test-token"),
  loadPlatformClientConfig: vi.fn().mockResolvedValue({}),
  loadWorkspaceId: vi.fn().mockResolvedValue("source"),
}));

interface FixtureOptions {
  auth?: boolean;
  machineUsers?: Record<string, object>;
  migrationMachineUser?: string;
  seedMachineUser?: string;
  seedRows?: boolean;
  migrationScript?: boolean;
  extraSeedNamespace?: boolean;
}

function fixture(directory: string, options: FixtureOptions = {}) {
  const migrationsDir = path.join(directory, "migrations");
  writeInitialSchema(migrationsDir, { User: snapshotType("User") });
  writeDiff(migrationsDir, 1, []);
  if (options.migrationScript) {
    fs.writeFileSync(
      path.join(migrationsDir, "0001/migrate.ts"),
      "export async function main() {}\n",
    );
  }
  const dataDir = path.join(directory, "seed/data");
  fs.mkdirSync(dataDir, { recursive: true });
  if (options.seedRows !== false) {
    fs.writeFileSync(path.join(dataDir, "User.jsonl"), '{"name":"Ada"}\n');
  }
  fs.symlinkSync(path.resolve("node_modules"), path.join(directory, "node_modules"), "junction");
  fs.writeFileSync(
    path.join(directory, "user.ts"),
    'import { db, unsafeAllowAllTypePermission, unsafeAllowAllGqlPermission } from "@tailor-platform/sdk"; export const user = db.table("User", { name: db.string() }).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);\n',
  );
  fs.writeFileSync(
    path.join(directory, "tsconfig.json"),
    '{"compilerOptions":{"target":"ESNext","module":"ESNext"}}',
  );
  if (options.extraSeedNamespace) {
    fs.writeFileSync(
      path.join(directory, "audit.ts"),
      'import { db, unsafeAllowAllTypePermission, unsafeAllowAllGqlPermission } from "@tailor-platform/sdk"; export const audit = db.table("Audit", { name: db.string() }).permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission);\n',
    );
    fs.writeFileSync(path.join(dataDir, "Audit.jsonl"), '{"name":"Created"}\n');
  }
  const config = {
    name: "migration-test",
    db: {
      tailordb: {
        files: ["./user.ts"],
        migration: { directory: "./migrations", machineUser: options.migrationMachineUser },
      },
      ...(options.extraSeedNamespace ? { audit: { files: ["./audit.ts"] } } : {}),
    },
    ...(options.auth !== false
      ? {
          auth: { name: "auth", machineUsers: options.machineUsers ?? { admin: {}, migrator: {} } },
        }
      : {}),
  };
  const configPath = path.join(directory, "tailor.config.ts");
  fs.writeFileSync(
    configPath,
    `export default ${JSON.stringify(config)};
     export const plugins = [{ id: "@tailor-platform/seed", description: "Seed data",
       pluginConfig: ${JSON.stringify({ distPath: path.join(directory, "seed"), machineUserName: options.seedMachineUser })} }];`,
  );
  const assertionPath = path.join(directory, "assert.ts");
  fs.writeFileSync(assertionPath, "export async function main() {}\n");
  const client = {
    getWorkspace: vi
      .fn()
      .mockResolvedValue({ workspace: { id: "source", region: "asia-northeast" } }),
    getApplication: vi.fn().mockResolvedValue({ application: { name: "migration-test" } }),
    getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: { "sdk-migration": "m0000" } } }),
    listTailorDBTypes: vi.fn().mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name"])],
      nextPageToken: "",
    }),
    listTailorDBGQLPermissions: vi.fn().mockResolvedValue({ permissions: [], nextPageToken: "" }),
    createWorkspace: vi.fn().mockRejectedValue(new Error("Unexpected workspace creation")),
    execScript: vi.fn().mockResolvedValue({ executionId: "execution" }),
    getFunctionExecution: vi.fn().mockResolvedValue({
      execution: {
        status: FunctionExecution_Status.SUCCESS,
        result: '{"success":true}',
        logEntries: [],
      },
    }),
  };
  vi.mocked(initOperatorClient).mockResolvedValue(client as unknown as OperatorClient);
  return {
    client,
    configPath,
    assertionPath,
    dependencies: createMigrationTestDependencies(),
    options: { configPath, workspaceId: "source", data: "seed" } satisfies MigrationTestOptions,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("migration test machine users", () => {
  test.each([
    { label: "Auth is absent", fixture: { auth: false }, code: "AUTH_CONFIG_REQUIRED" },
    {
      label: "no machine user is available",
      fixture: { machineUsers: {} },
      code: "MACHINE_USER_REQUIRED",
    },
    {
      label: "the seed plugin names an undefined user",
      fixture: { seedMachineUser: "ghost" },
      code: "MACHINE_USER_NOT_FOUND",
    },
    {
      label: "the namespace names an undefined user",
      fixture: { migrationMachineUser: "ghost" },
      code: "MACHINE_USER_NOT_FOUND",
    },
  ])("rejects seed execution before workspace creation when $label", async (row) => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, row.fixture);

    await expect(runMigrationTest(app.options, app.dependencies)).rejects.toMatchObject({
      code: row.code,
    });
    expect(app.client.createWorkspace).not.toHaveBeenCalled();
  });

  test("validates seed namespaces without migration history", async () => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, { seedRows: false, extraSeedNamespace: true });

    await expect(
      runMigrationTest({ ...app.options, machineUser: "ghost" }, app.dependencies),
    ).rejects.toMatchObject({
      code: "MACHINE_USER_NOT_FOUND",
      context: { machineUsers: [{ namespace: "audit", machineUser: "ghost" }] },
    });
    expect(app.client.createWorkspace).not.toHaveBeenCalled();
  });

  test("reports every seed namespace without a machine user together", async () => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, { machineUsers: {}, extraSeedNamespace: true });

    await expect(app.dependencies.prepare(app.options)).rejects.toMatchObject({
      code: "MACHINE_USER_REQUIRED",
      context: { namespaces: ["tailordb", "audit"] },
    });
  });

  test.each([
    {
      label: "explicit override",
      migrationMachineUser: "ghost",
      seedMachineUser: "ghost",
      machineUser: "migrator",
      seedUser: "migrator",
      assertionUser: "migrator",
    },
    {
      label: "seed plugin before namespace config",
      migrationMachineUser: "migrator",
      seedMachineUser: "admin",
      machineUser: undefined,
      seedUser: "admin",
      assertionUser: "migrator",
    },
    {
      label: "namespace config before Auth default",
      migrationMachineUser: "migrator",
      seedMachineUser: undefined,
      machineUser: undefined,
      seedUser: "migrator",
      assertionUser: "migrator",
    },
    {
      label: "first Auth machine user",
      migrationMachineUser: undefined,
      seedMachineUser: undefined,
      machineUser: undefined,
      seedUser: "admin",
      assertionUser: "admin",
    },
  ])("executes seed and assertion scripts using $label", async (row) => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, row);
    const options = {
      ...app.options,
      assertionPath: app.assertionPath,
      machineUser: row.machineUser,
    };
    const prepared = await app.dependencies.prepare(options);

    await app.dependencies.seedData({
      prepared,
      targetWorkspaceId: "target",
      sourceWorkspaceId: "source",
      applicationName: "migration-test",
    });
    await app.dependencies.runAssertion({
      prepared,
      targetWorkspaceId: "target",
      assertionPath: app.assertionPath,
      machineUser: row.machineUser,
    });

    expect(app.client.execScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "migration-test-seed-tailordb.ts",
        invoker: { namespace: "auth", machineUserName: row.seedUser },
      }),
    );
    expect(app.client.execScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "migration-test-assert-tailordb.ts",
        invoker: { namespace: "auth", machineUserName: row.assertionUser },
      }),
    );
  });

  test.each(["seed", "clone"] as const)(
    "allows %s mode without Auth when no scripts run",
    async (data) => {
      using tmp = tempDir("migration-test-machine-user-");
      const app = fixture(tmp.dir, {
        auth: false,
        seedRows: false,
        migrationMachineUser: "unused",
      });
      fs.writeFileSync(path.join(tmp.dir, "seed/data/PendingOnly.jsonl"), '{"name":"Pending"}\n');

      const prepared = await app.dependencies.prepare({ ...app.options, data });
      await app.dependencies.seedData({
        prepared,
        targetWorkspaceId: "target",
        sourceWorkspaceId: "source",
        applicationName: "migration-test",
      });

      expect(app.client.execScript).not.toHaveBeenCalled();
    },
  );

  test("validates assertion users in clone mode before creating a workspace", async () => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, { auth: false });

    await expect(
      runMigrationTest(
        { ...app.options, data: "clone", assertionPath: app.assertionPath },
        app.dependencies,
      ),
    ).rejects.toMatchObject({ code: "AUTH_CONFIG_REQUIRED" });
    expect(app.client.createWorkspace).not.toHaveBeenCalled();
  });

  test("validates pending migration script users in clone mode before creating a workspace", async () => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, { migrationScript: true, migrationMachineUser: "ghost" });

    await expect(
      runMigrationTest({ ...app.options, data: "clone" }, app.dependencies),
    ).rejects.toMatchObject({
      code: "MACHINE_USER_NOT_FOUND",
      context: { machineUsers: [{ namespace: "tailordb", machineUser: "ghost" }] },
    });
    expect(app.client.createWorkspace).not.toHaveBeenCalled();
  });

  test("allows an explicit user to override an undefined migration script user in clone mode", async () => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir, {
      migrationScript: true,
      migrationMachineUser: "ghost",
      seedMachineUser: "ghost",
    });

    await expect(
      app.dependencies.prepare({ ...app.options, data: "clone", machineUser: "migrator" }),
    ).resolves.toMatchObject({ pendingNamespaces: ["tailordb"] });
  });

  test("rejects an undefined seed machine user before creating a workspace", async () => {
    using tmp = tempDir("migration-test-machine-user-");
    const app = fixture(tmp.dir);

    await expect(
      runMigrationTest({ ...app.options, machineUser: "typo-user" }, app.dependencies),
    ).rejects.toMatchObject({
      code: "MACHINE_USER_NOT_FOUND",
      suggestion:
        "Pass a machine user defined in auth.machineUsers to --machine-user (admin, migrator), or add 'typo-user' to auth.machineUsers.",
      context: {
        authNamespace: "auth",
        machineUsers: [{ namespace: "tailordb", machineUser: "typo-user" }],
      },
    });
    expect(app.client.createWorkspace).not.toHaveBeenCalled();
  });
});
