import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createCommonArgs, runCommand } from "@tailor-platform/sdk/cli";
import open from "open";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedStudioCommand } from "./studio";

vi.mock("open", () => ({ default: vi.fn() }));

const sdk = vi.hoisted(() => ({ loadSeedContext: vi.fn() }));
const lines = vi.hoisted(() => ({ startStudioServer: vi.fn() }));

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

vi.mock("@lines-db/studio", () => lines);

let distPath: string;
let dataDir: string;
let cogs: string;
let startStudioServer: typeof lines.startStudioServer;
let closeStudio: ReturnType<typeof vi.fn<() => Promise<void>>>;

function writeRows(file: string, rows: object[]): void {
  writeFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
  distPath = mkdtempSync(path.join(tmpdir(), "seed-studio-command-"));
  dataDir = path.join(distPath, "data");
  cogs = path.join(dataDir, "cogs");
  mkdirSync(cogs, { recursive: true });
  writeRows(path.join(dataDir, "Item.jsonl"), [{ id: "i1" }]);
  writeRows(path.join(cogs, "Item.jsonl"), []);
  sdk.loadSeedContext.mockResolvedValue({
    config: { path: path.join(distPath, "tailor.config.ts") },
    distPath,
    datasets: {},
    idpUser: null,
    namespaces: [
      {
        namespace: "tailordb",
        types: ["Item"],
        dependencies: { Item: [] },
        selfRefTypes: [],
        requiredFields: { Item: [] },
      },
    ],
  });
  closeStudio = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  startStudioServer = lines.startStudioServer;
  startStudioServer.mockImplementation(async () => {
    const listenersBefore = process.listenerCount("SIGTERM");
    const stopWhenListening = setInterval(() => {
      if (process.listenerCount("SIGTERM") === listenersBefore) return;
      clearInterval(stopWhenListening);
      process.emit("SIGTERM");
    }, 1);
    return { url: "http://127.0.0.1:4848", token: "token", close: closeStudio };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(distPath, { recursive: true, force: true });
});

function runStudio(args: string[]) {
  return runCommand(seedStudioCommand, args, {
    globalArgs: z.strictObject(createCommonArgs({ verboseAlias: "v" })),
  });
}

describe("seedStudioCommand", () => {
  test("opens the seed data directory under the seedPlugin distPath", async () => {
    const result = await runStudio([]);

    expect(result.exitCode).toBe(0);
    expect(startStudioServer).toHaveBeenCalledWith(
      expect.objectContaining({ dataDir, port: 4848, writeFilledValues: "primaryKey" }),
    );
  });

  test("opens the given data directory instead", async () => {
    const result = await runStudio([cogs]);

    expect(result.exitCode).toBe(0);
    expect(startStudioServer).toHaveBeenCalledWith(expect.objectContaining({ dataDir: cogs }));
    expect(sdk.loadSeedContext).not.toHaveBeenCalled();
  });

  test("opens the selected datasets together with the base seed data, sharing its schema files", async () => {
    const result = await runStudio(["--dataset", "cogs"]);

    expect(result.exitCode).toBe(0);
    expect(startStudioServer).toHaveBeenCalledWith(
      expect.objectContaining({ dataDir: [dataDir, cogs], schemaDir: dataDir }),
    );
  });

  test("opens only the selected datasets with --no-base", async () => {
    const result = await runStudio(["--dataset", "cogs", "--no-base"]);

    expect(result.exitCode).toBe(0);
    expect(startStudioServer).toHaveBeenCalledWith(
      expect.objectContaining({ dataDir: cogs, schemaDir: dataDir }),
    );
  });

  test("passes --port and --write-filled-values through", async () => {
    const result = await runStudio(["--port", "0", "--write-filled-values", "all"]);

    expect(result.exitCode).toBe(0);
    expect(startStudioServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 0, writeFilledValues: "all" }),
    );
  });

  test("tells where the studio runs and stops it when the command is stopped", async () => {
    await runStudio([]);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:4848"));
    expect(closeStudio).toHaveBeenCalledTimes(1);
  });

  test("leaves no signal listeners behind once stopped", async () => {
    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");

    await runStudio([]);

    expect(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")).toBe(before);
  });

  test("does not open a browser unless asked", async () => {
    await runStudio([]);

    expect(open).not.toHaveBeenCalled();
  });

  test("opens the studio in the browser with --open", async () => {
    const result = await runStudio(["--open"]);

    expect(result.exitCode).toBe(0);
    expect(open).toHaveBeenCalledWith("http://127.0.0.1:4848");
  });

  test("keeps serving and tells the address when the browser cannot be opened", async () => {
    vi.mocked(open).mockRejectedValue(new Error("no browser"));

    const result = await runStudio(["--open"]);

    expect(result.exitCode).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("open the URL above manually"),
    );
  });

  test("prints the address and the data directory as JSON with --json", async () => {
    await runStudio(["--json"]);

    expect(logger.out).toHaveBeenCalledWith({ url: "http://127.0.0.1:4848", dataDir });
  });

  test("tells to pass --port when the port is already in use", async () => {
    startStudioServer.mockRejectedValue(
      Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:4848"), {
        code: "EADDRINUSE",
      }),
    );

    const result = await runStudio([]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("Port 4848 is already in use");
    expect(String(result.error)).toContain("--port");
  });

  test("rejects a path combined with --dataset", async () => {
    const result = await runStudio([cogs, "--dataset", "cogs"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("cannot be combined with a path");
    expect(startStudioServer).not.toHaveBeenCalled();
  });

  test("rejects --no-base without a dataset", async () => {
    const result = await runStudio(["--no-base"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("--no-base needs at least one --dataset");
    expect(startStudioServer).not.toHaveBeenCalled();
  });

  test("tells to generate first when the seed data directory is missing", async () => {
    rmSync(dataDir, { recursive: true, force: true });

    const result = await runStudio([]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("Seed data directory not found");
    expect(String(result.error)).toContain("`tailor generate` to create it");
    expect(startStudioServer).not.toHaveBeenCalled();
  });
});
