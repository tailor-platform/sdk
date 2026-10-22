import { createCommonArgs, runCommand } from "@tailor-platform/sdk/cli";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedRetryCommand } from "./retry";
import { hashChunkArgs, toRetryLabels } from "./retry-labels";

const sdk = vi.hoisted(() => ({
  bundleSeedScript: vi.fn(),
  chunkSeedData: vi.fn(),
  initOperatorClient: vi.fn(),
  inspectScriptWorkflow: vi.fn(),
  loadAccessToken: vi.fn(),
  loadSeedContext: vi.fn(),
  loadWorkspaceId: vi.fn(),
  show: vi.fn(),
  withKeptScriptWorkflow: vi.fn(),
}));

const workflow = vi.hoisted(() => ({
  runScript: vi.fn(),
  retain: vi.fn(),
}));

const jsonl = vi.hoisted(() => ({
  assertSeedDataDirectory: vi.fn(),
  loadSeedData: vi.fn(),
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
vi.mock("./jsonl", () => jsonl);
vi.mock("./datasets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./datasets")>()),
  ...datasets,
}));

const CHUNKS = [
  { data: { User: [{ id: "u1" }] }, order: ["User"], index: 0, total: 3 },
  { data: { User: [{ id: "u2" }] }, order: ["User"], index: 1, total: 3 },
  { data: { User: [{ id: "u3" }] }, order: ["User"], index: 2, total: 3 },
];

function chunkArgsOf(upsert: boolean) {
  return CHUNKS.map((chunk) => ({
    data: chunk.data,
    order: chunk.order,
    selfRefTypes: [],
    selfRefFields: {},
    selfRefKeys: {},
    upsert,
  }));
}

const FAILED_EXECUTION = "0b3f3b3e-6f5a-4a38-9c3f-0a1b2c3d4e5f";

function failedChunkLabels(overrides: { chunkIndex?: number; failedAt?: number } = {}) {
  return toRetryLabels({
    chunkIndex: overrides.chunkIndex ?? 1,
    total: 3,
    hash: hashChunkArgs(chunkArgsOf(false)),
    upsert: false,
    executionId: FAILED_EXECUTION,
    failedAt: overrides.failedAt ?? 1_792_000_000,
  });
}

function namespaceConfig(namespace: string) {
  return {
    dependencies: { User: [] },
    namespace,
    requiredFields: { User: [] },
    selfRefTypes: [],
    types: ["User"],
  };
}

function succeeded(inserted: number) {
  return {
    error: undefined,
    logs: "",
    result: JSON.stringify({
      success: true,
      processed: { User: { inserted, updated: 0, skipped: 0 } },
      errors: [],
    }),
    success: true,
  };
}

function runRetryCommand(args: string[]) {
  return runCommand(seedRetryCommand, args, {
    // Strip unknown global arguments like the plugin entrypoint.
    globalArgs: z.object(createCommonArgs({ verboseAlias: "v" })),
  });
}

function runRetry(args: string[] = []) {
  return runRetryCommand(["--machine-user", "manager", ...args]);
}

function errorCode(result: { error?: unknown }): string | undefined {
  return (result.error as { code?: string } | undefined)?.code;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", undefined);
  vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
  vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
  datasets.selectDatasets.mockReturnValue({ names: [], dirs: [] });
  sdk.loadSeedContext.mockResolvedValue({
    config: { path: "/workspace/tailor.config.ts" },
    distPath: "/seed",
    idpUser: null,
    machineUserName: undefined,
    namespaces: [namespaceConfig("tailordb")],
  });
  sdk.show.mockResolvedValue({ auth: "auth", name: "my-app" });
  sdk.loadAccessToken.mockResolvedValue("token");
  sdk.loadWorkspaceId.mockResolvedValue("workspace-id");
  sdk.initOperatorClient.mockReturnValue({});
  jsonl.loadSeedData.mockImplementation((_dirs: string[], typeNames: string[]) =>
    Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "u1" }]])),
  );
  sdk.bundleSeedScript.mockResolvedValue({
    bundledCode: "code",
    namespace: "tailordb",
    typesIncluded: ["User"],
  });
  sdk.chunkSeedData.mockReturnValue(CHUNKS);
  sdk.inspectScriptWorkflow.mockResolvedValue({
    workflowId: "wf-kept",
    labels: failedChunkLabels(),
    activeExecutionId: undefined,
    latestExecutionId: FAILED_EXECUTION,
  });
  sdk.withKeptScriptWorkflow.mockImplementation(
    async (
      options: { workflowId: string; name: string },
      use: (
        run: (arg: unknown) => Promise<unknown>,
        controls: { retain: typeof workflow.retain },
      ) => Promise<unknown>,
    ) =>
      use((arg) => workflow.runScript({ workflowId: options.workflowId, arg }), {
        retain: workflow.retain,
      }),
  );
  workflow.runScript.mockResolvedValue(succeeded(1));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seedRetryCommand", () => {
  test("runs the failed chunk and the chunks after it, leaving the chunks before it alone", async () => {
    const result = await runRetry();

    expect(result.exitCode).toBe(0);
    expect(workflow.runScript.mock.calls.map(([call]) => call.arg.data)).toEqual([
      CHUNKS[1]?.data,
      CHUNKS[2]?.data,
    ]);
  });

  test("starts the workflow that the failed run kept", async () => {
    await runRetry();

    expect(sdk.withKeptScriptWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tailor-seed-tailordb--tailordb",
        workflowId: "wf-kept",
      }),
      expect.any(Function),
    );
  });

  test("keeps nothing once the remaining chunks succeed", async () => {
    await runRetry();

    expect(workflow.retain).not.toHaveBeenCalled();
  });

  test("reports the rows the retry processed as JSON", async () => {
    await runRetry(["--json"]);

    expect(logger.out).toHaveBeenCalledWith({ success: true, processed: { User: 2 } });
  });

  test("keeps the workflow again with the chunk that failed this time", async () => {
    workflow.runScript.mockResolvedValueOnce(succeeded(1)).mockResolvedValueOnce({
      error: undefined,
      logs: "",
      result: '{"success":false,"processed":{},"errors":["User: duplicate id"]}',
      success: true,
      executionId: "exec-this-time",
    });

    const result = await runRetry();

    expect(result.exitCode).toBe(1);
    expect(workflow.retain).toHaveBeenCalledWith(
      expect.objectContaining({
        "seed-retry-chunk": "c2",
        "seed-retry-total": "n3",
        "seed-retry-exec": "eexec-this-time",
      }),
    );
  });

  test("keeps nothing when the retried chunk's outcome is not known", async () => {
    workflow.runScript.mockResolvedValueOnce(succeeded(1)).mockResolvedValueOnce({
      error: "Script execution failed with unknown error",
      logs: "",
      result: "",
      success: false,
      executionId: "exec-this-time",
    });

    const result = await runRetry();

    expect(result.exitCode).toBe(1);
    expect(workflow.retain).not.toHaveBeenCalled();
  });

  test("sends the chunks with the upsert option of the failed run", async () => {
    sdk.inspectScriptWorkflow.mockResolvedValue({
      workflowId: "wf-kept",
      labels: toRetryLabels({
        chunkIndex: 2,
        total: 3,
        hash: hashChunkArgs(chunkArgsOf(true)),
        upsert: true,
        executionId: FAILED_EXECUTION,
        failedAt: 1_792_000_000,
      }),
      activeExecutionId: undefined,
      latestExecutionId: FAILED_EXECUTION,
    });

    await runRetry();

    expect(workflow.runScript).toHaveBeenCalledWith(
      expect.objectContaining({ arg: expect.objectContaining({ upsert: true }) }),
    );
  });

  test("fails with an error of its own when no workflow was kept", async () => {
    sdk.inspectScriptWorkflow.mockResolvedValue(undefined);

    const result = await runRetry();

    expect(result.exitCode).toBe(1);
    expect(errorCode(result)).toBe("SEED_RETRY_NOTHING_TO_RETRY");
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("tells a kept workflow that holds no record apart from no workflow at all", async () => {
    sdk.inspectScriptWorkflow.mockResolvedValue({
      workflowId: "wf-leftover",
      labels: { "sdk-name": "my-app" },
      activeExecutionId: undefined,
      latestExecutionId: undefined,
    });

    const result = await runRetry();

    expect(errorCode(result)).toBe("SEED_RETRY_NOT_RECORDED");
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("refuses to start while an execution of the kept workflow is still running", async () => {
    sdk.inspectScriptWorkflow.mockResolvedValue({
      workflowId: "wf-kept",
      labels: failedChunkLabels(),
      activeExecutionId: "exec-running",
      latestExecutionId: "exec-running",
    });

    const result = await runRetry();

    expect(errorCode(result)).toBe("SEED_RETRY_EXECUTION_ACTIVE");
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("refuses to retry when a later execution ran after the chunk failed", async () => {
    sdk.inspectScriptWorkflow.mockResolvedValue({
      workflowId: "wf-kept",
      labels: failedChunkLabels(),
      activeExecutionId: undefined,
      latestExecutionId: "a-later-execution",
    });

    const result = await runRetry();

    expect(errorCode(result)).toBe("SEED_RETRY_INTERRUPTED");
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("refuses to retry when the seed data no longer matches the failed run", async () => {
    jsonl.loadSeedData.mockImplementation((_dirs: string[], typeNames: string[]) =>
      Object.fromEntries(typeNames.map((typeName) => [typeName, [{ id: "changed" }]])),
    );
    sdk.chunkSeedData.mockReturnValue(
      CHUNKS.map((chunk) => ({ ...chunk, data: { User: [{ id: "changed" }] } })),
    );

    const result = await runRetry();

    expect(errorCode(result)).toBe("SEED_RETRY_DATA_CHANGED");
    expect(workflow.runScript).not.toHaveBeenCalled();
  });

  test("refuses to retry when the data splits into a different number of chunks", async () => {
    sdk.chunkSeedData.mockReturnValue(CHUNKS.slice(0, 2));

    const result = await runRetry();

    expect(errorCode(result)).toBe("SEED_RETRY_DATA_CHANGED");
  });

  test("retries the namespace that failed last when several kept one", async () => {
    sdk.loadSeedContext.mockResolvedValue({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [namespaceConfig("first"), namespaceConfig("second")],
    });
    sdk.inspectScriptWorkflow.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        workflowId: `wf-${name}`,
        labels: failedChunkLabels({
          failedAt: name.endsWith("second") ? 1_792_000_100 : 1_792_000_000,
        }),
        activeExecutionId: undefined,
        latestExecutionId: FAILED_EXECUTION,
      }),
    );

    await runRetry();

    expect(sdk.withKeptScriptWorkflow).toHaveBeenCalledTimes(1);
    expect(sdk.withKeptScriptWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-tailor-seed-tailordb--second" }),
      expect.any(Function),
    );
  });

  test("rebuilds the chunks from only the tables the failed apply was limited to", async () => {
    sdk.loadSeedContext.mockResolvedValue({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [
        {
          ...namespaceConfig("tailordb"),
          dependencies: { User: [], Order: [] },
          requiredFields: { User: [], Order: [] },
          types: ["User", "Order"],
        },
      ],
    });

    await runRetry(["Order"]);

    expect(jsonl.loadSeedData).toHaveBeenCalledWith(
      expect.anything(),
      ["Order"],
      expect.anything(),
    );
  });

  test("rebuilds the chunks from every table when no table names are given", async () => {
    sdk.loadSeedContext.mockResolvedValue({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [
        {
          ...namespaceConfig("tailordb"),
          dependencies: { User: [], Order: [] },
          requiredFields: { User: [], Order: [] },
          types: ["User", "Order"],
        },
      ],
    });

    await runRetry();

    expect(jsonl.loadSeedData.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["User", "Order"]),
    );
  });

  test("looks only at the namespaces that hold the named tables", async () => {
    sdk.loadSeedContext.mockResolvedValue({
      config: { path: "/workspace/tailor.config.ts" },
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [
        namespaceConfig("first"),
        {
          ...namespaceConfig("second"),
          dependencies: { Order: [] },
          requiredFields: { Order: [] },
          types: ["Order"],
        },
      ],
    });

    await runRetry(["Order"]);

    expect(sdk.inspectScriptWorkflow).toHaveBeenCalledTimes(1);
    expect(sdk.inspectScriptWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tailor-seed-tailordb--second" }),
    );
  });

  test("rejects a namespace that is not in the config", async () => {
    const result = await runRetry(["--namespace", "missing"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain('No entities found in namespace "missing"');
  });

  test("needs a machine user", async () => {
    const result = await runRetryCommand([]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("Machine user name is required");
  });
});
