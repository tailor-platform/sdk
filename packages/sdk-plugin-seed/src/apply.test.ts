import { createCommonArgs, runCommand } from "@tailor-platform/sdk/cli";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedApplyCommand } from "./apply";

const sdk = vi.hoisted(() => ({
  bundleSeedScript: vi.fn(),
  chunkSeedData: vi.fn(),
  discardScriptWorkflow: vi.fn(),
  initOperatorClient: vi.fn(),
  loadAccessToken: vi.fn(),
  loadSeedContext: vi.fn(),
  loadWorkspaceId: vi.fn(),
  show: vi.fn(),
  truncate: vi.fn(),
  withScriptWorkflow: vi.fn(),
}));

const workflow = vi.hoisted(() => ({
  runScript: vi.fn(),
  retain: vi.fn(),
}));

const jsonl = vi.hoisted(() => ({
  assertSeedDataDirectory: vi.fn(),
  loadSeedData: vi.fn(),
}));

const seedModule = vi.hoisted(() => ({
  hookSeedRows: vi.fn(),
}));

const datasets = vi.hoisted(() => ({
  selectDatasets: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  newline: vi.fn(),
  out: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tailor-platform/sdk/cli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tailor-platform/sdk/cli")>()),
  ...sdk,
  logger,
}));
vi.mock("@tailor-platform/sdk/seed", () => seedModule);
vi.mock("./jsonl", () => jsonl);
vi.mock("./datasets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./datasets")>()),
  ...datasets,
}));

beforeEach(() => {
  vi.resetAllMocks();
  datasets.selectDatasets.mockReturnValue({ names: [], dirs: [] });
  seedModule.hookSeedRows.mockImplementation(
    async ({ rows }: { rows: Record<string, unknown>[] }) =>
      rows.map((row) => ({ password: "pw", ...row })),
  );
  // Isolate the env-bound args so ambient shell exports cannot leak in.
  vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", undefined);
  vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
  vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
  sdk.loadSeedContext.mockResolvedValue({
    config: { path: "/workspace/tailor.config.ts" },
    distPath: "/seed",
    idpUser: {
      idpNamespace: "idp",
      seedScriptCode: "seed-user-code",
      listScriptCode: "list-user-code",
      truncateScriptCode: "truncate-user-code",
    },
    machineUserName: undefined,
    namespaces: [
      {
        dependencies: { User: [] },
        namespace: "tailordb",
        requiredFields: { User: [] },
        selfRefTypes: [],
        types: ["User"],
      },
    ],
  });
  sdk.show.mockResolvedValue({ auth: "auth" });
  sdk.loadAccessToken.mockResolvedValue("token");
  sdk.loadWorkspaceId.mockResolvedValue("workspace-id");
  sdk.initOperatorClient.mockReturnValue({});
  sdk.truncate.mockResolvedValue(undefined);
  sdk.discardScriptWorkflow.mockResolvedValue(undefined);
  sdk.withScriptWorkflow.mockImplementation(
    async (
      options: { name: string },
      use: (
        run: (arg: unknown) => Promise<unknown>,
        controls: { retain: typeof workflow.retain },
      ) => Promise<unknown>,
    ) => use((arg) => workflow.runScript({ name: options.name, arg }), { retain: workflow.retain }),
  );
  workflow.runScript.mockImplementation(({ name }: { name: string }) =>
    Promise.resolve({
      error: undefined,
      logs: "",
      result: idpScriptResult(name, [{ id: "1", name: "Ada" }]),
      success: true,
    }),
  );
  jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
    Object.fromEntries(
      typeNames.map((typeName) => [typeName, typeName === "_User" ? [{ name: "Ada" }] : []]),
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type IdpUserRef = { id: string; name: string };

/**
 * Default result for the IdP scripts: the listing returns `users`, each
 * truncate chunk reports every user in it deleted, and seeding reports one row.
 * @param name - Script name passed to executeScript
 * @param users - Users the listing script returns
 * @param chunk - Users passed to the truncate script, when any
 * @returns Serialized script result
 */
function idpScriptResult(name: string, users: IdpUserRef[], chunk?: unknown[]): string {
  if (name === "tailor-seed-idp-list--idp") {
    return JSON.stringify({ success: true, users });
  }
  if (name === "tailor-seed-idp-truncate--idp") {
    const total = chunk?.length ?? users.length;
    return JSON.stringify({ success: true, deleted: total, notFound: 0, total, errors: [] });
  }
  return '{"success":true,"processed":1}';
}

function runApplyCommand(args: string[]) {
  return runCommand(seedApplyCommand, args, {
    // Strip unknown global arguments like the plugin entrypoint.
    globalArgs: z.object(createCommonArgs({ verboseAlias: "v" })),
  });
}

async function runApply(args: string[]): Promise<void> {
  const result = await runApplyCommand(["--machine-user", "manager", ...args]);
  expect(result.exitCode).toBe(0);
}

describe("seedApplyCommand", () => {
  test.each([false, true])("applies all datasets with truncate and no-base=%j", async (noBase) => {
    datasets.selectDatasets.mockReturnValue({
      names: ["cogs", "local"],
      dirs: ["/seed/data/cogs", "/seed/data/local"],
    });
    await runApply([
      "--all-datasets",
      "--truncate",
      "--yes",
      "--json",
      ...(noBase ? ["--no-base"] : []),
    ]);
    expect(datasets.selectDatasets).toHaveBeenCalledWith(expect.anything(), [], true);
    const dirs = [...(noBase ? [] : ["/seed/data"]), "/seed/data/cogs", "/seed/data/local"];
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(dirs, ["User"], expect.anything());
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(dirs, ["_User"], { keyField: "name" });
    expect(sdk.truncate).toHaveBeenCalledWith({
      configPath: "tailor.config.ts",
      profile: undefined,
      workspaceId: undefined,
      all: true,
    });
    expect(logger.out).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, datasets: ["cogs", "local"] }),
    );
  });

  describe("_User password", () => {
    const rowsWithoutPassword = () =>
      jsonl.loadSeedData.mockImplementation((_dirs: string[], typeNames: string[]) =>
        Object.fromEntries(
          typeNames.map((typeName) => [typeName, typeName === "_User" ? [{ name: "Ada" }] : []]),
        ),
      );

    test("passes the rows through the _User schema hook from the base data directory", async () => {
      await runApply(["_User"]);
      expect(seedModule.hookSeedRows).toHaveBeenCalledWith({
        schemaDir: "/seed/data",
        table: "_User",
        rows: [{ name: "Ada" }],
      });
    });

    test("sends a password the hook supplied as initialPassword and keeps one written in the file", async () => {
      jsonl.loadSeedData.mockImplementation((_dirs: string[], typeNames: string[]) =>
        Object.fromEntries(
          typeNames.map((typeName) => [
            typeName,
            typeName === "_User" ? [{ name: "Ada" }, { name: "Bob", password: "own" }] : [],
          ]),
        ),
      );
      await runApply(["--upsert", "_User"]);
      expect(workflow.runScript).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "tailor-seed-idp-seed--idp",
          arg: expect.objectContaining({
            users: [
              { name: "Ada", initialPassword: "pw" },
              { name: "Bob", password: "own" },
            ],
          }),
        }),
      );
    });

    test("still sends a row without password when the environment has none", async () => {
      rowsWithoutPassword();
      seedModule.hookSeedRows.mockImplementation(async ({ rows }: { rows: unknown[] }) => rows);
      await runApply(["_User"]);
      expect(workflow.runScript).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "tailor-seed-idp-seed--idp",
          arg: expect.objectContaining({ users: [{ name: "Ada" }] }),
        }),
      );
    });
  });

  test("rejects all datasets combined with named datasets before loading context", async () => {
    const result = await runApplyCommand(["--all-datasets", "--dataset", "cogs"]);
    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("cannot be combined with --dataset");
    expect(sdk.loadSeedContext).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
  });

  test("rejects a missing generated data directory before remote operations", async () => {
    jsonl.assertSeedDataDirectory.mockImplementationOnce(() => {
      throw new Error("Seed data directory not found: /seed/data");
    });

    const result = await runApplyCommand(["--machine-user", "manager", "--truncate", "--yes"]);

    expect(result.exitCode).toBe(1);
    expect(jsonl.assertSeedDataDirectory).toHaveBeenCalledWith("/seed/data");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.loadAccessToken).not.toHaveBeenCalled();
    expect(sdk.loadWorkspaceId).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("reads the base data alone when no dataset is selected", async () => {
    await runApply([]);

    expect(datasets.selectDatasets).toHaveBeenCalledWith(expect.anything(), [], false);
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(["/seed/data"], ["User"], {
      requireId: false,
      requiredFieldsByType: {},
    });
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(["/seed/data"], ["_User"], {
      keyField: "name",
    });
  });

  test("reads the selected datasets on top of the base data", async () => {
    datasets.selectDatasets.mockReturnValue({
      names: ["cogs", "local"],
      dirs: ["/seed/data/cogs", "/seed/data/local"],
    });

    await runApply(["--dataset", "preview", "--dataset", "local", "--json"]);

    expect(datasets.selectDatasets).toHaveBeenCalledWith(
      expect.anything(),
      ["preview", "local"],
      false,
    );
    const dataDirs = ["/seed/data", "/seed/data/cogs", "/seed/data/local"];
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(dataDirs, ["User"], expect.anything());
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(dataDirs, ["_User"], { keyField: "name" });
    expect(logger.out).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, datasets: ["cogs", "local"] }),
    );
  });

  test("reads only the selected datasets with --no-base", async () => {
    datasets.selectDatasets.mockReturnValue({
      names: ["snapshot"],
      dirs: ["/seed/data/snapshot"],
    });

    await runApply(["--dataset", "snapshot", "--no-base"]);

    expect(jsonl.assertSeedDataDirectory).toHaveBeenCalledWith("/seed/data");
    expect(jsonl.loadSeedData).toHaveBeenCalledWith(
      ["/seed/data/snapshot"],
      ["User"],
      expect.anything(),
    );
  });

  test("rejects --no-base without a dataset before remote operations", async () => {
    const result = await runApplyCommand(["--machine-user", "manager", "--no-base"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("--no-base needs at least one --dataset");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(jsonl.loadSeedData).not.toHaveBeenCalled();
  });

  test("reads every row before truncating, so unreadable data changes nothing", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDirs: string[], typeNames: string[]) => {
      if (typeNames.includes("_User")) {
        throw new Error("/seed/data/local/_User.jsonl:1: name is already defined");
      }
      return { User: [] };
    });

    const result = await runApplyCommand(["--machine-user", "manager", "--truncate", "--yes"]);

    expect(result.exitCode).toBe(1);
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("rejects an unknown dataset even when nothing is left to seed", async () => {
    datasets.selectDatasets.mockImplementation(() => {
      throw new Error('Unknown dataset "typo".');
    });

    const result = await runApplyCommand(["--skip-idp", "_User", "--dataset", "typo"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain('Unknown dataset "typo".');
    expect(logger.success).not.toHaveBeenCalled();
  });

  test("succeeds without remote operations when the project has no seed targets", async () => {
    sdk.loadSeedContext.mockResolvedValueOnce({
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [],
    });

    const result = await runApplyCommand(["--truncate", "--yes", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(logger.out).toHaveBeenCalledWith({ success: true, processed: {} });
    expect(logger.success).toHaveBeenCalledWith("No seed targets found.");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.loadAccessToken).not.toHaveBeenCalled();
    expect(sdk.loadWorkspaceId).not.toHaveBeenCalled();
    expect(sdk.initOperatorClient).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(workflow.runScript).not.toHaveBeenCalled();
    expect(jsonl.assertSeedDataDirectory).not.toHaveBeenCalled();
    expect(jsonl.loadSeedData).not.toHaveBeenCalled();
  });

  test("succeeds without remote operations when --skip-idp removes the only target", async () => {
    sdk.loadSeedContext.mockResolvedValueOnce({
      distPath: "/seed",
      idpUser: {
        seedScriptCode: "seed-user-code",
        listScriptCode: "list-user-code",
        truncateScriptCode: "truncate-user-code",
      },
      machineUserName: undefined,
      namespaces: [],
    });

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--skip-idp",
      "--truncate",
      "--yes",
    ]);

    expect(result.exitCode).toBe(0);
    expect(logger.success).toHaveBeenCalledWith("No seed targets found.");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.loadAccessToken).not.toHaveBeenCalled();
    expect(sdk.loadWorkspaceId).not.toHaveBeenCalled();
    expect(sdk.initOperatorClient).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("truncates all TailorDB data and the IdP user before seeding by default", async () => {
    await runApply(["--truncate", "--yes"]);

    expect(sdk.truncate).toHaveBeenCalledWith({
      all: true,
      configPath: "tailor.config.ts",
      profile: undefined,
      workspaceId: undefined,
    });
    expect(workflow.runScript).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "tailor-seed-idp-list--idp" }),
    );
    expect(workflow.runScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "tailor-seed-idp-truncate--idp" }),
    );
    expect(workflow.runScript).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ name: "tailor-seed-idp-seed--idp" }),
    );
  });

  describe("discarding the retry records before a truncate", () => {
    const discardedBeforeTruncate = () => {
      const truncatedAt = sdk.truncate.mock.invocationCallOrder[0];
      return sdk.discardScriptWorkflow.mock.calls
        .filter(
          (_call, index) => sdk.discardScriptWorkflow.mock.invocationCallOrder[index] < truncatedAt,
        )
        .map(([call]) => (call as { name: string }).name);
    };

    beforeEach(() => {
      sdk.loadSeedContext.mockResolvedValue({
        config: { path: "/workspace/tailor.config.ts" },
        distPath: "/seed",
        idpUser: null,
        machineUserName: undefined,
        namespaces: ["first", "second"].map((namespace) => ({
          dependencies: { [`${namespace}Table`]: [] },
          namespace,
          requiredFields: { [`${namespace}Table`]: [] },
          selfRefTypes: [],
          types: [`${namespace}Table`],
        })),
      });
    });

    test("discards the record of every namespace before truncating all tables", async () => {
      await runApply(["--truncate", "--yes"]);

      expect(discardedBeforeTruncate()).toEqual([
        "tailor-seed-tailordb--first",
        "tailor-seed-tailordb--second",
      ]);
    });

    test("discards only the record of the namespace being truncated", async () => {
      await runApply(["--truncate", "--yes", "--namespace", "second"]);

      expect(discardedBeforeTruncate()).toEqual(["tailor-seed-tailordb--second"]);
    });

    test("discards only the records of the namespaces holding the truncated tables", async () => {
      await runApply(["--truncate", "--yes", "firstTable"]);

      expect(discardedBeforeTruncate()).toEqual(["tailor-seed-tailordb--first"]);
    });

    test("keeps the records when the truncate is cancelled", async () => {
      await runApply(["--truncate"]).catch(() => undefined);

      expect(sdk.truncate).not.toHaveBeenCalled();
    });
  });

  test("limits truncation to a namespace and excludes the IdP user", async () => {
    await runApply(["--truncate", "--yes", "--namespace", "tailordb"]);

    expect(sdk.truncate).toHaveBeenCalledWith({
      configPath: "tailor.config.ts",
      namespace: "tailordb",
      profile: undefined,
      workspaceId: undefined,
    });
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("limits truncation to selected TailorDB tables and excludes the IdP user", async () => {
    await runApply(["--truncate", "--yes", "User"]);

    expect(sdk.truncate).toHaveBeenCalledWith({
      configPath: "tailor.config.ts",
      profile: undefined,
      tables: ["User"],
      workspaceId: undefined,
    });
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("truncates and seeds only the IdP user when it is the selected entity", async () => {
    await runApply(["--truncate", "--yes", "_User"]);

    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(workflow.runScript).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "tailor-seed-idp-list--idp" }),
    );
    expect(workflow.runScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "tailor-seed-idp-truncate--idp" }),
    );
    expect(workflow.runScript).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ name: "tailor-seed-idp-seed--idp" }),
    );
  });

  test("skips IdP user truncation and seeding with --skip-idp", async () => {
    await runApply(["--truncate", "--yes", "--skip-idp"]);

    expect(sdk.truncate).toHaveBeenCalledWith(expect.objectContaining({ all: true }));
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("does not print a success line when every _User row fails", async () => {
    workflow.runScript.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        error: undefined,
        logs: "",
        result:
          name === "tailor-seed-idp-seed--idp"
            ? JSON.stringify({
                success: false,
                processed: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                errors: ["Row 0 (Ada): boom"],
              })
            : '{"success":true,"deleted":1}',
        success: true,
      }),
    );

    const result = await runApplyCommand(["--machine-user", "manager"]);

    expect(result.exitCode).toBe(1);
    const loggedLines = logger.log.mock.calls.map(([line]) => String(line));
    expect(loggedLines.some((line) => line.includes("✓ _User"))).toBe(false);
  });

  test("splits _User rows into row-count chunks and aggregates processed counts", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ name: `user-${i}` }));
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, typeName === "_User" ? rows : []])),
    );
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) =>
        Promise.resolve({
          error: undefined,
          logs: "",
          result:
            name === "tailor-seed-idp-seed--idp"
              ? JSON.stringify({
                  success: true,
                  processed: arg?.users?.length ?? 0,
                  created: arg?.users?.length ?? 0,
                  updated: 0,
                  skipped: 0,
                  errors: [],
                })
              : '{"success":true,"deleted":1}',
          success: true,
        }),
    );

    const result = await runApplyCommand(["--machine-user", "manager", "--json"]);

    expect(result.exitCode).toBe(0);
    const idpCalls = workflow.runScript.mock.calls
      .map(
        ([options]) =>
          options as { name: string; arg?: { users?: unknown[]; offset?: number; total?: number } },
      )
      .filter((options) => options.name === "tailor-seed-idp-seed--idp");
    expect(idpCalls.map((options) => options.arg?.users?.length)).toEqual([25, 25, 1]);
    expect(idpCalls.map((options) => options.arg?.offset)).toEqual([0, 25, 50]);
    expect(idpCalls.map((options) => options.arg?.total)).toEqual([51, 51, 51]);
    const loggedLines = logger.log.mock.calls.map(([line]) => String(line));
    expect(loggedLines.some((line) => line.includes("Split into 3 chunks"))).toBe(true);
    expect(loggedLines.some((line) => line.includes("Chunk 1/3: 25 rows"))).toBe(true);
    expect(loggedLines.some((line) => line.includes("Chunk 2/3: 25 rows"))).toBe(true);
    expect(loggedLines.some((line) => line.includes("Chunk 3/3: 1 rows"))).toBe(true);
    expect(logger.out).toHaveBeenCalledWith({ success: true, processed: { _User: 51 } });
  });

  test("reports the processed counts before rethrowing when the _User workflow cannot be registered", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ name: `user-${i}` }));
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, typeName === "_User" ? rows : []])),
    );
    const setupError = new Error("permission denied: create workflow");
    sdk.withScriptWorkflow.mockRejectedValue(setupError);

    const result = await runApplyCommand(["--machine-user", "manager", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe(setupError);
    expect(logger.out).toHaveBeenCalledWith({ success: false, processed: {} });
  });

  test("reports confirmed progress before rethrowing a _User chunk transport error", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ name: `user-${i}` }));
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, typeName === "_User" ? rows : []])),
    );
    const transportError = new Error("[deadline_exceeded] context deadline exceeded");
    let idpCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name !== "tailor-seed-idp-seed--idp") {
          return Promise.resolve({
            error: undefined,
            logs: "",
            result: '{"success":true,"deleted":1}',
            success: true,
          });
        }
        idpCallCount += 1;
        if (idpCallCount > 1) {
          return Promise.reject(transportError);
        }
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: JSON.stringify({
            success: true,
            processed: arg?.users?.length ?? 0,
            created: arg?.users?.length ?? 0,
            updated: 0,
            skipped: 0,
            errors: [],
          }),
          success: true,
        });
      },
    );

    const result = await runApplyCommand(["--machine-user", "manager", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe(transportError);
    expect(logger.out).toHaveBeenCalledWith({ success: false, processed: { _User: 25 } });
    const warnedLines = logger.warn.mock.calls.map(([line]) => String(line));
    expect(
      warnedLines.some(
        (line) =>
          line.includes("25/30") &&
          line.includes("re-run the same command narrowed to `_User` with `--upsert`"),
      ),
    ).toBe(true);
  });

  test("continues after a known _User row failure and reports confirmed totals", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ name: `user-${i}` }));
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, typeName === "_User" ? rows : []])),
    );
    let idpCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name !== "tailor-seed-idp-seed--idp") {
          return Promise.resolve({
            error: undefined,
            logs: "",
            result: '{"success":true,"deleted":1}',
            success: true,
          });
        }
        idpCallCount += 1;
        const rowCount = arg?.users?.length ?? 0;
        const hasRowFailure = idpCallCount === 2;
        const processed = hasRowFailure ? rowCount - 1 : rowCount;
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: JSON.stringify({
            success: !hasRowFailure,
            processed,
            created: processed,
            updated: 0,
            skipped: 0,
            errors: hasRowFailure ? ["Row 27 (user-26): create failed"] : [],
          }),
          success: true,
        });
      },
    );

    const result = await runApplyCommand(["--machine-user", "manager", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(idpCallCount).toBe(3);
    expect(logger.out).toHaveBeenCalledWith({ success: false, processed: { _User: 50 } });
  });

  test("stops and reports progress when a _User chunk execution fails without a result", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ name: `user-${i}` }));
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, typeName === "_User" ? rows : []])),
    );
    let idpCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name !== "tailor-seed-idp-seed--idp") {
          return Promise.resolve({
            error: undefined,
            logs: "",
            result: '{"success":true,"deleted":1}',
            success: true,
          });
        }
        idpCallCount += 1;
        if (idpCallCount > 1) {
          return Promise.resolve({
            error: "execution failed",
            logs: "",
            result: "",
            success: false,
          });
        }
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: JSON.stringify({
            success: true,
            processed: arg?.users?.length ?? 0,
            created: arg?.users?.length ?? 0,
            updated: 0,
            skipped: 0,
            errors: [],
          }),
          success: true,
        });
      },
    );

    const result = await runApplyCommand(["--machine-user", "manager"]);

    expect(result.exitCode).toBe(1);
    expect(idpCallCount).toBe(2);
    const warnedLines = logger.warn.mock.calls.map(([line]) => String(line));
    expect(
      warnedLines.some(
        (line) =>
          line.includes("25/51") &&
          line.includes("re-run the same command narrowed to `_User` with `--upsert`"),
      ),
    ).toBe(true);
  });

  test("stops and reports progress when a _User chunk returns an unparseable result", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ name: `user-${i}` }));
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, typeName === "_User" ? rows : []])),
    );
    let idpCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name !== "tailor-seed-idp-seed--idp") {
          return Promise.resolve({
            error: undefined,
            logs: "",
            result: '{"success":true,"deleted":1}',
            success: true,
          });
        }
        idpCallCount += 1;
        if (idpCallCount > 1) {
          return Promise.resolve({
            error: undefined,
            logs: "",
            result: "not-json",
            success: true,
          });
        }
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: JSON.stringify({
            success: true,
            processed: arg?.users?.length ?? 0,
            created: arg?.users?.length ?? 0,
            updated: 0,
            skipped: 0,
            errors: [],
          }),
          success: true,
        });
      },
    );

    const result = await runApplyCommand(["--machine-user", "manager"]);

    expect(result.exitCode).toBe(1);
    expect(idpCallCount).toBe(2);
    const warnedLines = logger.warn.mock.calls.map(([line]) => String(line));
    expect(warnedLines.some((line) => line.includes("25/51"))).toBe(true);
  });

  test("passes --upsert through to the TailorDB and IdP seed scripts", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(
        typeNames.map((typeName) => [
          typeName,
          typeName === "_User" ? [{ name: "Ada" }] : [{ id: "u1" }],
        ]),
      ),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([{ data: { User: [{ id: "u1" }] }, order: ["User"] }]);
    workflow.runScript.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        error: undefined,
        logs: "",
        result:
          name === "tailor-seed-idp-seed--idp"
            ? '{"success":true,"processed":1,"created":0,"updated":1,"skipped":0,"errors":[]}'
            : '{"success":true,"processed":{"User":{"inserted":0,"updated":1,"skipped":0}},"errors":[]}',
        success: true,
      }),
    );

    await runApply(["--upsert", "--json"]);

    expect(logger.out).toHaveBeenCalledWith({ success: true, processed: { User: 1, _User: 1 } });
    expect(sdk.withScriptWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tailor-seed-tailordb--tailordb", code: "code" }),
      expect.any(Function),
    );
    expect(workflow.runScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tailor-seed-tailordb--tailordb",
        arg: expect.objectContaining({ upsert: true }),
      }),
    );
    expect(workflow.runScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tailor-seed-idp-seed--idp",
        arg: expect.objectContaining({ upsert: true }),
      }),
    );
  });

  test("stops running the remaining TailorDB chunks after one fails", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
      { data: { User: [{ id: "u2" }] }, order: ["User"], index: 1 },
    ]);
    workflow.runScript.mockResolvedValue({
      error: undefined,
      logs: "",
      result: '{"success":false,"processed":{},"errors":["User: duplicate id"]}',
      success: true,
    });

    const result = await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(result.exitCode).toBe(1);
    expect(workflow.runScript).toHaveBeenCalledTimes(1);
  });

  test("keeps the TailorDB workflow with the index of the chunk that failed", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
      { data: { User: [{ id: "u2" }] }, order: ["User"], index: 1 },
      { data: { User: [{ id: "u3" }] }, order: ["User"], index: 2 },
    ]);
    workflow.runScript
      .mockResolvedValueOnce({
        error: undefined,
        logs: "",
        result: '{"success":true,"processed":{"User":{"inserted":1,"updated":0,"skipped":0}}}',
        success: true,
      })
      .mockResolvedValueOnce({
        error: undefined,
        logs: "",
        result: '{"success":false,"processed":{},"errors":["User: duplicate id"]}',
        success: true,
        executionId: "exec-failed",
      });

    await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(workflow.retain).toHaveBeenCalledTimes(1);
    expect(workflow.retain).toHaveBeenCalledWith(
      expect.objectContaining({
        "seed-retry-chunk": "c1",
        "seed-retry-total": "n3",
        "seed-retry-upsert": "false",
        "seed-retry-exec": "eexec-failed",
      }),
    );
  });

  test("keeps nothing and says so when it is not known whether a chunk was applied", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
    ]);
    workflow.runScript.mockResolvedValue({
      error: "Script execution failed with unknown error",
      logs: "",
      result: "",
      success: false,
      executionId: "exec-failed",
    });

    await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(workflow.retain).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not known whether this chunk was applied"),
      expect.anything(),
    );
  });

  test.each([
    ["an empty result", ""],
    ["a result without a success field", "{}"],
  ])("keeps nothing and warns when a finished job returns %s", async (_label, result) => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
    ]);
    workflow.runScript.mockResolvedValue({
      error: undefined,
      logs: "",
      result,
      success: true,
      executionId: "exec-finished",
    });

    await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(workflow.retain).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not known whether this chunk was applied"),
      expect.anything(),
    );
  });

  test("warns that the data may be applied and keeps nothing when the result cannot be read", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
    ]);
    const readError = new Error("get function execution failed");
    workflow.runScript.mockRejectedValue(readError);

    const result = await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(result.error).toBe(readError);
    expect(workflow.retain).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("run `tailor seed apply --upsert`"),
      expect.anything(),
    );
  });

  test("keeps nothing and warns when the script cannot tell whether its transaction committed", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
    ]);
    workflow.runScript.mockResolvedValue({
      error: undefined,
      logs: "",
      result: '{"success":false,"processed":{},"errors":["commit failed"],"outcomeUnknown":true}',
      success: true,
      executionId: "exec-finished",
    });

    await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(workflow.retain).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not known whether this chunk was applied"),
      expect.anything(),
    );
  });

  test("removes the workflow an earlier failed run kept when the namespace has no data to seed", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, []])),
    );

    await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(sdk.discardScriptWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tailor-seed-tailordb--tailordb" }),
    );
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("keeps nothing when every TailorDB chunk succeeds", async () => {
    jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
    );
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["User"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0 },
    ]);
    workflow.runScript.mockResolvedValue({
      error: undefined,
      logs: "",
      result: '{"success":true,"processed":{"User":{"inserted":1,"updated":0,"skipped":0}}}',
      success: true,
    });

    await runApplyCommand(["--machine-user", "manager", "--skip-idp"]);

    expect(workflow.retain).not.toHaveBeenCalled();
  });

  test("sorts a self-referencing table's full record set before it reaches chunkSeedData", async () => {
    // Dumped rows are ordered by uuid `id`, so a child can be listed before
    // the parent it references. chunkSeedData splits purely by byte size
    // with no dependency awareness, and the generated script can only
    // reorder records within a single chunk it receives — so the table must
    // already be parent-before-child before chunking, not after.
    sdk.loadSeedContext.mockResolvedValue({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: undefined,
      machineUserName: undefined,
      namespaces: [
        {
          dependencies: { Category: [] },
          namespace: "tailordb",
          requiredFields: { Category: [] },
          selfRefFields: { Category: ["parentId"] },
          selfRefTypes: ["Category"],
          types: ["Category"],
        },
      ],
    });
    jsonl.loadSeedData.mockImplementation(() => ({
      Category: [
        { id: "child", parentId: "parent" },
        { id: "parent", parentId: null },
      ],
    }));
    sdk.bundleSeedScript.mockResolvedValue({
      bundledCode: "code",
      namespace: "tailordb",
      typesIncluded: ["Category"],
    });
    sdk.chunkSeedData.mockReturnValue([
      { data: { Category: [{ id: "parent" }, { id: "child" }] }, order: ["Category"] },
    ]);
    workflow.runScript.mockResolvedValue({
      error: undefined,
      logs: "",
      result:
        '{"success":true,"processed":{"Category":{"inserted":2,"updated":0,"skipped":0}},"errors":[]}',
      success: true,
    });

    await runApply([]);

    expect(sdk.chunkSeedData).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          Category: [
            { id: "parent", parentId: null },
            { id: "child", parentId: "parent" },
          ],
        },
      }),
    );
  });

  test("deletes listed IdP users in row-count chunks and reports the total", async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, name: `user-${i}` }));
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) =>
        Promise.resolve({
          error: undefined,
          logs: "",
          result: idpScriptResult(name, users, arg?.users),
          success: true,
        }),
    );

    await runApply(["--truncate", "--yes", "_User"]);

    const truncateCalls = workflow.runScript.mock.calls
      .map(
        ([options]) =>
          options as {
            name: string;
            arg?: { users?: IdpUserRef[]; offset?: number; total?: number };
          },
      )
      .filter((options) => options.name === "tailor-seed-idp-truncate--idp");
    expect(truncateCalls.map((options) => options.arg?.users)).toEqual([
      users.slice(0, 25),
      users.slice(25),
    ]);
    expect(truncateCalls.map((options) => options.arg?.offset)).toEqual([0, 25]);
    expect(truncateCalls.map((options) => options.arg?.total)).toEqual([30, 30]);
    const loggedLines = logger.log.mock.calls.map(([line]) => String(line));
    expect(loggedLines.some((line) => line.includes("Split into 2 chunks"))).toBe(true);
    expect(loggedLines.some((line) => line.includes("Chunk 2/2: 5 users"))).toBe(true);
    expect(loggedLines.some((line) => line.includes("✓ _User: 30 users deleted"))).toBe(true);
  });

  test("reports confirmed progress before rethrowing an IdP truncate transport error", async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, name: `user-${i}` }));
    const transportError = new Error("[deadline_exceeded] context deadline exceeded");
    let truncateCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name === "tailor-seed-idp-truncate--idp") {
          truncateCallCount += 1;
          if (truncateCallCount > 1) {
            return Promise.reject(transportError);
          }
        }
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: idpScriptResult(name, users, arg?.users),
          success: true,
        });
      },
    );

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--truncate",
      "--yes",
      "_User",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe(transportError);
    const warnedLines = logger.warn.mock.calls.map(([line]) => String(line));
    expect(
      warnedLines.some(
        (line) =>
          line.includes("25/30 users confirmed deleted before the failure") &&
          line.includes("re-run the same command to retry safely"),
      ),
    ).toBe(true);
  });

  test("reports confirmed progress when an IdP truncate chunk has an unknown outcome", async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, name: `user-${i}` }));
    let truncateCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name === "tailor-seed-idp-truncate--idp") {
          truncateCallCount += 1;
          if (truncateCallCount > 1) {
            return Promise.resolve({
              error: "execution failed",
              logs: "",
              result: "",
              success: false,
            });
          }
        }
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: idpScriptResult(name, users, arg?.users),
          success: true,
        });
      },
    );

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--truncate",
      "--yes",
      "_User",
    ]);

    expect(result.exitCode).toBe(1);
    expect(truncateCallCount).toBe(2);
    const warnedLines = logger.warn.mock.calls.map(([line]) => String(line));
    expect(
      warnedLines.some(
        (line) =>
          line.includes("25/30 users confirmed deleted before the failure") &&
          line.includes("re-run the same command to retry safely"),
      ),
    ).toBe(true);
  });

  test("counts users that were already gone as deleted", async () => {
    const users = [
      { id: "1", name: "Ada" },
      { id: "ghost", name: "ghost@example.com" },
    ];
    workflow.runScript.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        error: undefined,
        logs: "",
        result:
          name === "tailor-seed-idp-truncate--idp"
            ? JSON.stringify({ success: true, deleted: 1, notFound: 1, total: 2, errors: [] })
            : idpScriptResult(name, users),
        success: true,
      }),
    );

    await runApply(["--truncate", "--yes", "_User"]);

    const loggedLines = logger.log.mock.calls.map(([line]) => String(line));
    expect(
      loggedLines.some((line) => line.includes("✓ _User: 1 users deleted, 1 already deleted")),
    ).toBe(true);
  });

  test("skips the delete script when the IdP has no users", async () => {
    workflow.runScript.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        error: undefined,
        logs: "",
        result: idpScriptResult(name, []),
        success: true,
      }),
    );

    await runApply(["--truncate", "--yes", "_User"]);

    const scriptNames = workflow.runScript.mock.calls.map(
      ([options]) => (options as { name: string }).name,
    );
    expect(scriptNames).toEqual(["tailor-seed-idp-list--idp", "tailor-seed-idp-seed--idp"]);
  });

  test("fails truncation when the listing script returns no user list", async () => {
    workflow.runScript.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        error: undefined,
        logs: "",
        result:
          name === "tailor-seed-idp-list--idp" ? '{"success":true}' : idpScriptResult(name, []),
        success: true,
      }),
    );

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--truncate",
      "--yes",
      "_User",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toEqual(new Error("IdP user truncation failed."));
    const scriptNames = workflow.runScript.mock.calls.map(
      ([options]) => (options as { name: string }).name,
    );
    expect(scriptNames).toEqual(["tailor-seed-idp-list--idp"]);
  });

  test("rejects an @tailor-platform/sdk that lacks the IdP user listing script", async () => {
    sdk.loadSeedContext.mockResolvedValueOnce({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: {
        seedScriptCode: "seed-user-code",
        truncateScriptCode: "truncate-user-code",
      },
      machineUserName: undefined,
      namespaces: [],
    });

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--truncate",
      "--yes",
      "_User",
    ]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("does not provide the IdP user listing script");
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("fails truncation and skips seeding when a delete chunk reports errors", async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, name: `user-${i}` }));
    let truncateCallCount = 0;
    workflow.runScript.mockImplementation(
      ({ name, arg }: { name: string; arg?: { users?: unknown[] } }) => {
        if (name === "tailor-seed-idp-truncate--idp") {
          truncateCallCount += 1;
        }
        const failing = name === "tailor-seed-idp-truncate--idp" && truncateCallCount === 1;
        return Promise.resolve({
          error: undefined,
          logs: "",
          result: failing
            ? JSON.stringify({
                success: false,
                deleted: 22,
                notFound: 2,
                total: 25,
                errors: ["User id-3 (user-3): permission denied"],
              })
            : idpScriptResult(name, users, arg?.users),
          success: true,
        });
      },
    );

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--truncate",
      "--yes",
      "_User",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toEqual(new Error("IdP user truncation failed."));
    expect(truncateCallCount).toBe(2);
    const scriptNames = workflow.runScript.mock.calls.map(
      ([options]) => (options as { name: string }).name,
    );
    expect(scriptNames).not.toContain("tailor-seed-idp-seed--idp");
    const erroredLines = logger.error.mock.calls.map(([line]) => String(line));
    expect(
      erroredLines.some((line) => line.includes("User id-3 (user-3): permission denied")),
    ).toBe(true);
    const loggedLines = logger.log.mock.calls.map(([line]) => String(line));
    expect(loggedLines.some((line) => line.includes("✓ _User"))).toBe(false);
    const warnedLines = logger.warn.mock.calls.map(([line]) => String(line));
    expect(
      warnedLines.some((line) => line.includes("27 users deleted, 2 already deleted, 1 failed")),
    ).toBe(true);
  });
});
