import * as fs from "node:fs";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand, type AnyCommand } from "@politty/zod";
import {
  TailorDBGQLPermissionSchema,
  TailorDBTypeSchema,
  type TailorDBGQLPermission,
  type TailorDBType,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { assertDefined } from "#/utils/assert";
import { generate } from "./generate";
import { rebaselineCommand } from "./rebaseline";
import { resolveCommand } from "./resolve";
import { scriptCommand } from "./script";
import { loadSnapshot, reconstructSnapshotFromMigrations } from "./snapshot";
import { applySnapshotPlan, planSnapshotApply } from "./snapshot-apply";
import { statusCommand } from "./status";
import { syncCommand } from "./sync";
import { validateCommand } from "./validate";

const platform = vi.hoisted(() => ({
  workspaceId: "12345678-1234-4abc-8def-123456789012",
  client: undefined as unknown,
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => platform.workspaceId),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(async () => platform.client),
}));

const LEDGER = "ledger-db";
const LEDGER_TRN = resourceTrn(platform.workspaceId, "tailordb", LEDGER);

const ENTRY_WITH_NOTE = `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const table = db
  .table("Entry", { title: db.string(), note: db.string({ optional: true }) })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

/** A request that writes a table. */
interface TableWrite {
  namespaceName?: string;
  tailordbType?: MessageInitShape<typeof TailorDBTypeSchema>;
}

/** A request that writes the GraphQL permission of a table. */
interface GqlPermissionWrite {
  namespaceName?: string;
  typeName?: string;
  permission?: MessageInitShape<typeof TailorDBGQLPermissionSchema>;
}

function namespaceStore<T>(stores: Map<string, Map<string, T>>, namespace = ""): Map<string, T> {
  const store = stores.get(namespace) ?? new Map<string, T>();
  stores.set(namespace, store);
  return store;
}

/**
 * A Platform workspace keeping the TailorDB tables, GraphQL permissions and metadata labels written to it.
 * @returns The client, and the state it keeps
 */
function fakePlatform() {
  const tables = new Map<string, Map<string, TailorDBType>>();
  const gqlPermissions = new Map<string, Map<string, TailorDBGQLPermission>>();
  const labels = new Map<string, Record<string, string>>();
  const putTable = async (request: TableWrite) => {
    const table = create(TailorDBTypeSchema, request.tailordbType);
    namespaceStore(tables, request.namespaceName).set(table.name, table);
    return { tailordbType: table };
  };
  const putGqlPermission = async (request: GqlPermissionWrite) => {
    namespaceStore(gqlPermissions, request.namespaceName).set(
      request.typeName ?? "",
      create(TailorDBGQLPermissionSchema, request.permission),
    );
    return {};
  };
  const client = mockOperatorClient({
    listTailorDBTypes: async ({ namespaceName }) => ({
      tailordbTypes: [...namespaceStore(tables, namespaceName).values()],
      nextPageToken: "",
    }),
    createTailorDBType: putTable,
    updateTailorDBType: putTable,
    listTailorDBGQLPermissions: async ({ namespaceName }) => ({
      permissions: [...namespaceStore(gqlPermissions, namespaceName)].map(
        ([typeName, permission]) => ({ typeName, permission }),
      ),
      nextPageToken: "",
    }),
    createTailorDBGQLPermission: putGqlPermission,
    updateTailorDBGQLPermission: putGqlPermission,
    getMetadata: async ({ trn }) => {
      const current = labels.get(trn ?? "");
      if (!current) throw new ConnectError("metadata not found", Code.NotFound);
      return { metadata: { trn, labels: current } };
    },
    setMetadata: async (request) => {
      labels.set(request.trn ?? "", { ...request.labels });
      return {};
    },
    listWorkflowExecutions: notFound,
    getWorkflowByName: notFound,
    deleteWorkflowJobFunction: notFound,
    deleteFunctionRegistry: notFound,
  });
  return { client, tables, labels };
}

async function notFound(): Promise<never> {
  throw new ConnectError("not found", Code.NotFound);
}

function silenceCommandLogs(): Disposable {
  return silenceLogger("log", "info", "success", "warn", "newline", "debug");
}

function stubProjectEnv(dir: string): void {
  vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
  vi.stubEnv("TAILOR_PLATFORM_PROFILE", "");
  vi.stubEnv("EDITOR", undefined);
  vi.stubEnv("VISUAL", undefined);
}

const tempProjectDir = () =>
  fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-migration-")));

describe("tailordb migration commands with a workspace config", () => {
  let template: string;
  let dir: string;
  let configPath: string;
  let migrationsDir: string;
  let remote: ReturnType<typeof fakePlatform>;
  let logs: Disposable;

  beforeAll(async () => {
    template = tempProjectDir();
    const templateConfig = writeWorkspaceProject(template, {
      db: `{
    "customer-db": { files: ["./db/customer/*.ts"] },
    "order-db": { files: ["./db/order/*.ts"] },
    "ledger-db": { files: ["./db/ledger/*.ts"], migration: { directory: "./migrations/ledger" } },
  }`,
    });
    stubProjectEnv(template);
    using _logs = silenceCommandLogs();
    await generate({ configPath: templateConfig, yes: true });
    fs.rmSync(path.join(template, "db", "ledger", "table.ts"));
    fs.writeFileSync(path.join(template, "db", "ledger", "entry.ts"), ENTRY_WITH_NOTE);
    await generate({ configPath: templateConfig, yes: true });
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    fs.rmSync(template, { recursive: true, force: true });
  });

  beforeEach(() => {
    dir = tempProjectDir();
    fs.cpSync(template, dir, { recursive: true });
    configPath = path.join(dir, "tailor.config.ts");
    migrationsDir = path.join(dir, "migrations", "ledger");
    stubProjectEnv(dir);
    logs = silenceCommandLogs();
    remote = fakePlatform();
    platform.client = remote.client;
  });

  afterEach(() => {
    logs[Symbol.dispose]();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(command: AnyCommand, args: string[]): Promise<void> {
    const result = await runCommand(command, [...args, "--config", configPath]);
    if (!result.success) throw result.error;
  }

  async function runJson(command: AnyCommand, args: string[]): Promise<unknown> {
    using _json = jsonMode();
    using stdout = captureStdout();
    await run(command, args);
    return JSON.parse(stdout.output);
  }

  async function deployLedger(migrationNumber: number, labels: Record<string, string>) {
    const snapshot = assertDefined(
      reconstructSnapshotFromMigrations(migrationsDir, migrationNumber),
      `snapshot of migration ${migrationNumber}`,
    );
    const target = {
      client: remote.client,
      workspaceId: platform.workspaceId,
      namespace: LEDGER,
      snapshot,
    };
    const plan = await planSnapshotApply(target);
    await applySnapshotPlan({ ...target, manifestOptions: {}, plan });
    remote.labels.set(LEDGER_TRN, labels);
  }

  const entryFields = () =>
    Object.keys(remote.tables.get(LEDGER)?.get("Entry")?.schema?.fields ?? {}).toSorted();

  test("status reports a namespace no application lists", async () => {
    await deployLedger(0, { "sdk-migration": "m0000" });

    await expect(runJson(statusCommand, [])).resolves.toMatchObject([
      { status: "ok", namespace: LEDGER, currentMigration: 0, pendingMigrations: [{ number: 1 }] },
    ]);
  });

  test("validate checks a namespace no application lists", async () => {
    await deployLedger(0, { "sdk-migration": "m0000" });

    await expect(runJson(validateCommand, [])).resolves.toMatchObject([
      { namespace: LEDGER, valid: true },
    ]);
  });

  test("validate asks for table names unique across the workspace when two namespaces share one", async () => {
    fs.writeFileSync(
      path.join(dir, "db", "ledger", "other.ts"),
      fs.readFileSync(path.join(dir, "db", "order", "table.ts"), "utf8"),
    );

    await expect(run(validateCommand, [])).rejects.toMatchObject({
      suggestion:
        "Give each TailorDB type a name that is unique across all TailorDB namespaces in the workspace.",
    });
  });

  test("sync applies a migration of a namespace no application lists", async () => {
    await run(syncCommand, ["1", "--yes"]);

    expect(entryFields()).toEqual(["note", "title"]);
    expect(remote.labels.get(LEDGER_TRN)).toMatchObject({ "sdk-migration": "m0001" });
  });

  test("resolve rolls back a migration of a namespace no application lists", async () => {
    await deployLedger(1, { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" });

    await run(resolveCommand, ["--rollback", "--yes"]);

    expect(entryFields()).toEqual(["title"]);
    expect(remote.labels.get(LEDGER_TRN)).toEqual({ "sdk-migration": "m0000" });
  });

  test("rebaseline collapses the migrations of a namespace no application lists", async () => {
    await deployLedger(1, { "sdk-migration": "m0001" });

    await run(rebaselineCommand, ["--yes"]);

    expect(fs.readdirSync(migrationsDir)).toEqual(["0000"]);
    const { rebaseline } = loadSnapshot(path.join(migrationsDir, "0000", "schema.json"));
    expect(remote.labels.get(LEDGER_TRN)).toEqual({
      "sdk-migration": "m0000",
      "sdk-migration-history": rebaseline?.historyId,
    });
  });

  test("script adds a migration script to a namespace no application lists", async () => {
    await run(scriptCommand, ["1"]);

    expect(fs.existsSync(path.join(migrationsDir, "0001", "migrate.ts"))).toBe(true);
  });
});
