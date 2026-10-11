import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const STUDIO_TEST_TIMEOUT_MS = 30_000;

// The data dir lives outside the workspace, so its files import the SDK by
// resolved URL instead of by package name.
const sdkUrls = {
  root: import.meta.resolve("@tailor-platform/sdk"),
  seed: import.meta.resolve("@tailor-platform/sdk/seed"),
  test: import.meta.resolve("@tailor-platform/sdk/test"),
};

// The schema imports the table without an extension, the way the seedPlugin
// output imports a project's TailorDB files.
const tableSource = `
import { db } from "${sdkUrls.root}";

export const widget = db.table("Widget", {
  name: db.string(),
  ...db.fields.timestamps(),
});
`;

const schemaSource = `
import { t } from "${sdkUrls.root}";
import { defineSchema } from "${sdkUrls.seed}";
import { createStandardSchema, createTailorDBHook } from "${sdkUrls.test}";
import { widget } from "./widget-table";

const schemaType = t.object({
  ...widget.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
  ...widget.omitFields(["id", "createdAt", "updatedAt"]),
});

export const hook = createTailorDBHook(widget);
export const schema = defineSchema(createStandardSchema(schemaType, hook, widget));
`;

type Studio = {
  process: ChildProcess;
  stdout: () => string;
  stderr: () => string;
};

const started: ChildProcess[] = [];

function assertBuilt(): void {
  if (!existsSync(path.join(packageRoot, "dist/index.js"))) {
    throw new Error(
      "packages/sdk-plugin-seed is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-seed build` first.",
    );
  }
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, FORCE_COLOR: "0" },
  });
}

function startStudio(args: string[]): Studio {
  const child = spawn(process.execPath, [cliEntry, "studio", ...args], {
    cwd: packageRoot,
    env: { PATH: process.env.PATH, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so a test can signal the whole tree as a terminal
    // does, and cleanup can reach the studio it starts.
    detached: true,
  });
  started.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return { process: child, stdout: () => stdout, stderr: () => stderr };
}

async function waitFor(condition: () => boolean, studio: Studio): Promise<void> {
  const deadline = Date.now() + STUDIO_TEST_TIMEOUT_MS;
  while (!condition()) {
    if (studio.process.exitCode !== null || studio.process.signalCode !== null) {
      throw new Error(`studio exited early:\n${studio.stdout()}\n${studio.stderr()}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out:\n${studio.stdout()}\n${studio.stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForUrl(studio: Studio): Promise<string> {
  await waitFor(() => studio.stdout().includes("\n"), studio);
  const { url } = JSON.parse(studio.stdout().split("\n")[0] ?? "") as { url: string };
  return url;
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return await new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}

async function readToken(url: string): Promise<string> {
  const page = await (await fetch(url)).text();
  const token = /<meta name="studio-token" content="([^"]+)">/.exec(page)?.[1];
  if (!token) throw new Error(`The studio page carries no token:\n${page}`);
  return token;
}

async function writeDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seed-studio-"));
  await writeFile(path.join(dir, "widget-table.ts"), tableSource);
  await writeFile(path.join(dir, "Widget.schema.ts"), schemaSource);
  await writeFile(
    path.join(dir, "Widget.jsonl"),
    '{"id":"0b6b6f5e-3b8a-4d0e-9a1f-2c7d8e5a4b31","name":"first"}\n',
  );
  await writeFile(path.join(dir, "Gadget.jsonl"), "");
  return dir;
}

afterAll(() => {
  for (const child of started) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

describe("tailor seed studio", () => {
  let dataDir: string;
  let studio: Studio;
  let url: string;
  let token: string;

  async function api(pathname: string, body?: unknown): Promise<Response> {
    return await fetch(`${url}${pathname}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: url,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    assertBuilt();
    dataDir = await writeDataDir();
    studio = startStudio([dataDir, "--port", "0", "--json"]);
    url = await waitForUrl(studio);
    token = await readToken(url);
  }, STUDIO_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("reports where it serves as JSON", () => {
    expect(JSON.parse(studio.stdout().split("\n")[0] ?? "")).toEqual({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      dataDir,
    });
  });

  test("names the tables it does not show for lack of rows", async () => {
    await waitFor(() => studio.stderr().includes("Not shown"), studio);
    expect(studio.stderr()).toContain("Not shown until their JSONL file has a row: Gadget");
  });

  test(
    "serves the tables of the data directory",
    async () => {
      const response = await api("/api/tables");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        problems: unknown[];
        tables: { name: string; primaryKey: string; rowCount: number }[];
      };

      expect(body.problems).toEqual([]);
      expect(body.tables).toEqual([
        expect.objectContaining({ name: "Widget", primaryKey: "id", rowCount: 1 }),
      ]);
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "saves a new row with its generated id but without the values the hook fills in",
    async () => {
      const response = await api("/api/tables/Widget/changes", {
        inserts: [{ name: "second" }],
        updates: [],
        deletes: [],
      });
      expect(response.status).toBe(200);

      const lines = (await readFile(path.join(dataDir, "Widget.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toHaveLength(2);
      expect(Object.keys(lines[1] ?? {}).toSorted()).toEqual(["id", "name"]);
      expect(lines[1]).toMatchObject({ name: "second" });

      const validation = runCli(["validate", dataDir]);
      expect(validation.status).toBe(0);
      expect(validation.stderr).toContain("All records are valid");
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "fails when the studio cannot serve",
    async () => {
      const port = new URL(url).port;
      const second = startStudio([dataDir, "--port", port]);

      expect(await waitForExit(second.process)).toBe(1);
      expect(second.stderr()).toContain("The studio stopped with exit code 1 before serving.");
    },
    STUDIO_TEST_TIMEOUT_MS,
  );
});

describe("stopping tailor seed studio", () => {
  let dataDir: string;

  beforeAll(async () => {
    assertBuilt();
    dataDir = await writeDataDir();
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test(
    "stops the studio before exiting on SIGTERM",
    async () => {
      const studio = startStudio([dataDir, "--port", "0", "--json"]);
      const url = await waitForUrl(studio);
      const pid = studio.process.pid;
      if (pid === undefined) throw new Error("studio has no pid");

      process.kill(pid, "SIGTERM");
      await waitForExit(studio.process);

      await expect(fetch(url)).rejects.toThrow("fetch failed");
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "stops the studio before exiting on Ctrl+C",
    async () => {
      const studio = startStudio([dataDir, "--port", "0", "--json"]);
      const url = await waitForUrl(studio);
      const pid = studio.process.pid;
      if (pid === undefined) throw new Error("studio has no pid");

      process.kill(-pid, "SIGINT");
      await waitForExit(studio.process);

      await expect(fetch(url)).rejects.toThrow("fetch failed");
    },
    STUDIO_TEST_TIMEOUT_MS,
  );
});

describe("tailor seed studio arguments", () => {
  test("rejects a path that is not a directory", async () => {
    assertBuilt();
    const dir = await mkdtemp(path.join(os.tmpdir(), "seed-studio-file-"));
    try {
      const file = path.join(dir, "Widget.jsonl");
      await writeFile(file, "");

      const result = runCli(["studio", file]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Seed data path is not a directory: ${file}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
