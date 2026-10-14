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
function tableSource(name: string): string {
  return `
import { db } from "${sdkUrls.root}";

export const table = db.table("${name}", {
  name: db.string(),
  ...db.fields.timestamps(),
});
`;
}

function schemaSource(tableModule: string): string {
  return `
import { t } from "${sdkUrls.root}";
import { defineSchema } from "${sdkUrls.seed}";
import { createStandardSchema, createTailorDBHook } from "${sdkUrls.test}";
import { table } from "./${tableModule}";

const schemaType = t.object({
  ...table.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
  ...table.omitFields(["id", "createdAt", "updatedAt"]),
});

export const hook = createTailorDBHook(table);
export const schema = defineSchema(createStandardSchema(schemaType, hook, table));
`;
}

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

async function waitForGroupToEnd(pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    if (Date.now() > deadline) throw new Error("a process the studio started is still running");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function readToken(url: string): Promise<string> {
  const page = await (await fetch(url)).text();
  const token = /<meta name="studio-token" content="([^"]+)">/.exec(page)?.[1];
  if (!token) throw new Error(`The studio page carries no token:\n${page}`);
  return token;
}

async function writeDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seed-studio-"));
  await writeFile(path.join(dir, "widget-table.ts"), tableSource("Widget"));
  await writeFile(path.join(dir, "Widget.schema.ts"), schemaSource("widget-table"));
  await writeFile(
    path.join(dir, "Widget.jsonl"),
    '{"id":"0b6b6f5e-3b8a-4d0e-9a1f-2c7d8e5a4b31","name":"first"}\n',
  );
  await writeFile(path.join(dir, "gadget-table.ts"), tableSource("Gadget"));
  await writeFile(path.join(dir, "Gadget.schema.ts"), schemaSource("gadget-table"));
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

  test("reports where it serves, and the tables it does not show, as JSON", () => {
    expect(JSON.parse(studio.stdout().split("\n")[0] ?? "")).toEqual({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      dataDir,
      tablesWithoutRows: ["Gadget"],
    });
  });

  test(
    "reports its own address when a table module prints another one",
    async () => {
      const dir = await writeDataDir();
      try {
        await writeFile(
          path.join(dir, "widget-table.ts"),
          `console.log("Mock API running at http://localhost:3000");\n${tableSource("Widget")}`,
        );
        const other = startStudio([dir, "--port", "0", "--json"]);

        expect(await waitForUrl(other)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

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

  test(
    "writes nothing for a value the schema rejects",
    async () => {
      const file = path.join(dataDir, "Widget.jsonl");
      const before = await readFile(file, "utf8");

      const response = await api("/api/tables/Widget/changes", {
        inserts: [],
        updates: [{ key: "0b6b6f5e-3b8a-4d0e-9a1f-2c7d8e5a4b31", changes: { name: 12_345 } }],
        deletes: [],
      });

      expect(response.status).toBe(400);
      expect(await readFile(file, "utf8")).toBe(before);
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "shows a table once its JSONL file gets a first row",
    async () => {
      await writeFile(
        path.join(dataDir, "Gadget.jsonl"),
        '{"id":"5a5a5a5a-0000-4000-8000-000000000001","name":"gadget"}\n',
      );

      const deadline = Date.now() + STUDIO_TEST_TIMEOUT_MS / 2;
      let names: string[] = [];
      while (!names.includes("Gadget") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const body = (await (await api("/api/tables")).json()) as { tables: { name: string }[] };
        names = body.tables.map((table) => table.name);
      }

      expect(names.toSorted()).toEqual(["Gadget", "Widget"]);
    },
    STUDIO_TEST_TIMEOUT_MS,
  );
});

describe("stopping tailor seed studio", () => {
  let dataDir: string;

  async function stopsWith(studio: Studio, stop: (pid: number) => Promise<void>): Promise<void> {
    const pid = studio.process.pid;
    if (pid === undefined) throw new Error("studio has no pid");
    await stop(pid);
    await waitForExit(studio.process);
    await waitForGroupToEnd(pid);
  }

  beforeAll(async () => {
    assertBuilt();
    dataDir = await writeDataDir();
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test(
    "stops the studio on SIGTERM",
    async () => {
      const studio = startStudio([dataDir, "--port", "0", "--json"]);
      const url = await waitForUrl(studio);

      await stopsWith(studio, async (pid) => {
        process.kill(pid, "SIGTERM");
      });

      await expect(fetch(url)).rejects.toThrow("fetch failed");
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "stops the studio when SIGTERM arrives twice",
    async () => {
      const studio = startStudio([dataDir, "--port", "0", "--json"]);
      await waitForUrl(studio);

      await expect(
        stopsWith(studio, async (pid) => {
          process.kill(pid, "SIGTERM");
          try {
            process.kill(pid, "SIGTERM");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }),
      ).resolves.toBeUndefined();
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "names the tables it does not show, and stops on Ctrl+C",
    async () => {
      const studio = startStudio([dataDir, "--port", "0"]);
      await waitFor(() => studio.stderr().includes("Not shown"), studio);
      expect(studio.stderr()).toContain("Not shown until their JSONL file has a row: Gadget");

      await stopsWith(studio, async (pid) => {
        process.kill(-pid, "SIGINT");
      });
    },
    STUDIO_TEST_TIMEOUT_MS,
  );

  test(
    "stops a studio that is still starting",
    async () => {
      const dir = await writeDataDir();
      try {
        await writeFile(
          path.join(dir, "widget-table.ts"),
          `console.log("loading widgets");\nawait new Promise((resolve) => setTimeout(resolve, 600_000));\n${tableSource("Widget")}`,
        );
        const studio = startStudio([dir, "--port", "0"]);
        await waitFor(() => studio.stderr().includes("loading widgets"), studio);

        await expect(
          stopsWith(studio, async (pid) => {
            process.kill(pid, "SIGTERM");
          }),
        ).resolves.toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    STUDIO_TEST_TIMEOUT_MS,
  );
});

describe("tailor seed studio arguments", { timeout: STUDIO_TEST_TIMEOUT_MS }, () => {
  test("rejects a path that is not a directory", async () => {
    assertBuilt();
    const dir = await mkdtemp(path.join(os.tmpdir(), "seed-studio-file-"));
    try {
      const file = path.join(dir, "Widget.jsonl");
      await writeFile(file, "");

      const result = runCli(["studio", file]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${file} is not a directory.`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not suggest `tailor generate` for a path it was given", async () => {
    assertBuilt();
    const dir = await mkdtemp(path.join(os.tmpdir(), "seed-studio-missing-"));
    try {
      const missing = path.join(dir, "missing");

      const result = runCli(["studio", missing]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(missing);
      expect(result.stderr).not.toContain("tailor generate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
