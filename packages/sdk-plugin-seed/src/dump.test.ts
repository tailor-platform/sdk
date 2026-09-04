import { createCommonArgs, runCommand } from "@tailor-platform/sdk/cli";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedDumpCommand } from "./dump";

const sdk = vi.hoisted(() => ({
  bundleSeedDumpScript: vi.fn(),
  executeScript: vi.fn(),
  initOperatorClient: vi.fn(),
  loadAccessToken: vi.fn(),
  loadSeedContext: vi.fn(),
  loadWorkspaceId: vi.fn(),
  show: vi.fn(),
}));

const jsonl = vi.hoisted(() => ({
  existingSeedDataFiles: vi.fn(),
  writeSeedData: vi.fn(),
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
vi.mock("./jsonl", () => jsonl);

type DumpArg = { table: string; limit: number; after: string | null };

/**
 * Reply to each dump script execution with the rows of the requested table,
 * paged by the `limit` and `after` the command asks for.
 * @param rowsByTable - Rows each table holds, ordered by id
 * @returns A mock implementation for executeScript
 */
function dumpRows(rowsByTable: Record<string, { id: string; [key: string]: unknown }[]>) {
  return ({ arg }: { arg: DumpArg }) => {
    const all = rowsByTable[arg.table] ?? [];
    const remaining =
      arg.after !== null && arg.after !== undefined
        ? all.filter((row) => row.id > (arg.after ?? ""))
        : all;
    const rows = remaining.slice(0, arg.limit);
    const cursor = rows.length === arg.limit ? (rows.at(-1)?.id ?? null) : null;
    return Promise.resolve({
      error: undefined,
      logs: "",
      result: JSON.stringify({ success: true, rows, cursor, errors: [] }),
      success: true,
    });
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", undefined);
  vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
  vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
  sdk.loadSeedContext.mockResolvedValue({
    config: { path: "/workspace/tailor.config.ts" },
    distPath: "/seed",
    idpUser: null,
    machineUserName: undefined,
    namespaces: [
      {
        dependencies: { Order: ["User"], User: [] },
        namespace: "tailordb",
        omitFields: { Order: ["orderNumber"], User: [] },
        requiredFields: { Order: [], User: [] },
        selfRefTypes: [],
        types: ["Order", "User"],
      },
    ],
  });
  sdk.show.mockResolvedValue({ auth: "auth" });
  sdk.loadAccessToken.mockResolvedValue("token");
  sdk.loadWorkspaceId.mockResolvedValue("workspace-id");
  sdk.initOperatorClient.mockReturnValue({});
  sdk.bundleSeedDumpScript.mockResolvedValue({
    bundledCode: "dump-code",
    namespace: "tailordb",
  });
  sdk.executeScript.mockImplementation(dumpRows({ Order: [], User: [] }));
  jsonl.existingSeedDataFiles.mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function runDumpCommand(args: string[]) {
  return runCommand(seedDumpCommand, args, {
    // Strip unknown global arguments like the plugin entrypoint.
    globalArgs: z.object(createCommonArgs({ verboseAlias: "v" })),
  });
}

async function runDump(args: string[]): Promise<void> {
  const result = await runDumpCommand(["--machine-user", "manager", ...args]);
  expect(result.exitCode).toBe(0);
}

describe("seedDumpCommand", () => {
  test("writes every table in dependency order", async () => {
    sdk.executeScript.mockImplementation(
      dumpRows({
        Order: [{ id: "o1", user: "u1" }],
        User: [{ id: "u1", name: "Ada" }],
      }),
    );

    await runDump([]);

    expect(jsonl.writeSeedData.mock.calls.map(([, table]) => table)).toEqual(["User", "Order"]);
    expect(jsonl.writeSeedData).toHaveBeenCalledWith("/seed/data", "User", [
      { id: "u1", name: "Ada" },
    ]);
  });

  test("drops platform-assigned fields and empty values from dumped rows", async () => {
    sdk.executeScript.mockImplementation(
      dumpRows({
        Order: [{ id: "o1", note: null, orderNumber: 7, user: "u1" }],
        User: [],
      }),
    );

    await runDump([]);

    expect(jsonl.writeSeedData).toHaveBeenCalledWith("/seed/data", "Order", [
      { id: "o1", user: "u1" },
    ]);
  });

  test("pages through a table until it is exhausted", async () => {
    sdk.executeScript.mockImplementation(
      dumpRows({
        Order: [],
        User: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
      }),
    );

    await runDump(["--page-size", "2", "User"]);

    const dumpArgs = sdk.executeScript.mock.calls.map(
      ([options]) => (options as { arg: DumpArg }).arg,
    );
    const userPages = dumpArgs.filter((dumpArg) => dumpArg.table === "User");
    expect(userPages.map((dumpArg) => dumpArg.after)).toEqual([null, "u2"]);
    expect(jsonl.writeSeedData).toHaveBeenCalledWith("/seed/data", "User", [
      { id: "u1" },
      { id: "u2" },
      { id: "u3" },
    ]);
  });

  test("writes to --out instead of the seed data directory", async () => {
    await runDump(["--out", "/tmp/snapshot", "User"]);

    expect(jsonl.writeSeedData).toHaveBeenCalledWith("/tmp/snapshot", "User", []);
  });

  test("refuses to overwrite existing files without --force", async () => {
    jsonl.existingSeedDataFiles.mockReturnValue(["User"]);

    const result = await runDumpCommand(["--machine-user", "manager"]);

    expect(result.exitCode).toBe(1);
    expect(jsonl.writeSeedData).not.toHaveBeenCalled();
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });

  test("overwrites existing files with --force", async () => {
    jsonl.existingSeedDataFiles.mockReturnValue(["User"]);

    await runDump(["--force", "User"]);

    expect(jsonl.writeSeedData).toHaveBeenCalledWith("/seed/data", "User", []);
  });

  test("rejects dumping the IdP user before touching the config", async () => {
    const result = await runDumpCommand(["--machine-user", "manager", "_User"]);

    expect(result.exitCode).toBe(1);
    expect(sdk.loadSeedContext).not.toHaveBeenCalled();
    expect(jsonl.writeSeedData).not.toHaveBeenCalled();
  });

  test("fails when a machine user is configured nowhere", async () => {
    const result = await runDumpCommand([]);

    expect(result.exitCode).toBe(1);
    expect(sdk.show).not.toHaveBeenCalled();
    expect(jsonl.writeSeedData).not.toHaveBeenCalled();
  });

  test("succeeds without remote operations when the project has no tables", async () => {
    sdk.loadSeedContext.mockResolvedValueOnce({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [],
    });

    const result = await runDumpCommand(["--json"]);

    expect(result.exitCode).toBe(0);
    expect(logger.out).toHaveBeenCalledWith({ success: true, dumped: {} });
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });

  test("reports the row count per table in JSON mode", async () => {
    sdk.executeScript.mockImplementation(
      dumpRows({ Order: [{ id: "o1" }], User: [{ id: "u1" }, { id: "u2" }] }),
    );

    await runDump(["--json"]);

    expect(logger.out).toHaveBeenCalledWith({
      success: true,
      path: "/seed/data",
      dumped: { Order: 1, User: 2 },
    });
  });

  test("fails the run when the dump script reports an error", async () => {
    sdk.executeScript.mockResolvedValue({
      error: undefined,
      logs: "",
      result: JSON.stringify({ success: false, rows: [], cursor: null, errors: ["User: boom"] }),
      success: true,
    });

    const result = await runDumpCommand(["--machine-user", "manager", "User"]);

    expect(result.exitCode).toBe(1);
    expect(jsonl.writeSeedData).not.toHaveBeenCalled();
  });
});
