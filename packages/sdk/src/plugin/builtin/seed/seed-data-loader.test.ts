import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { generateSeedDataLoaderCode } from "./seed-data-loader";

type LoadSeedData = (
  dataDir: string,
  typeNames: string[],
  options?: {
    requireId?: boolean;
    requiredFieldsByType?: Record<string, string[]>;
  },
) => Record<string, Record<string, unknown>[]>;

const testDirs: string[] = [];

afterEach(() => {
  for (const testDir of testDirs.splice(0)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

async function loadGeneratedSeedDataLoader(): Promise<LoadSeedData> {
  const code = `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    ${generateSeedDataLoaderCode()}
    export { loadSeedData };
  `;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod = (await import(/* @vite-ignore */ url)) as { loadSeedData: LoadSeedData };
  return mod.loadSeedData;
}

function createDataDir(content: string): { dataDir: string; jsonlPath: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-seed-data-"));
  testDirs.push(dataDir);
  const jsonlPath = path.join(dataDir, "Customer.jsonl");
  fs.writeFileSync(jsonlPath, content);
  return { dataDir, jsonlPath };
}

describe("generateSeedDataLoaderCode", () => {
  test.each([
    ["missing", '{"name":"Alice"}\n', 1],
    ["null", '{"id":"customer-1"}\n{"id":null,"name":"Bob"}\n', 2],
  ])("rejects an %s id with the file and line number", async (_label, content, line) => {
    const loadSeedData = await loadGeneratedSeedDataLoader();
    const { dataDir, jsonlPath } = createDataDir(content);

    expect(() => loadSeedData(dataDir, ["Customer"], { requireId: true })).toThrowError(
      `${jsonlPath}:${line}: \`id\` is required with --upsert`,
    );
  });

  test("allows a missing id when upsert validation is disabled", async () => {
    const loadSeedData = await loadGeneratedSeedDataLoader();
    const { dataDir } = createDataDir('{"name":"Alice"}\n');

    expect(loadSeedData(dataDir, ["Customer"])).toEqual({
      Customer: [{ name: "Alice" }],
    });
  });

  test("skips blank lines between records", async () => {
    const loadSeedData = await loadGeneratedSeedDataLoader();
    const { dataDir } = createDataDir(
      '\n{"id":"customer-1","name":"Alice"}\n\n{"id":"customer-2","name":"Bob"}\n\n',
    );

    expect(loadSeedData(dataDir, ["Customer"])).toEqual({
      Customer: [
        { id: "customer-1", name: "Alice" },
        { id: "customer-2", name: "Bob" },
      ],
    });
  });

  test("rejects a missing required field before an upsert", async () => {
    const loadSeedData = await loadGeneratedSeedDataLoader();
    const { dataDir, jsonlPath } = createDataDir(
      '{"id":"customer-1","name":"Alice","email":"alice@example.com"}\n' +
        '{"id":"customer-2","name":"Bob"}\n',
    );

    expect(() =>
      loadSeedData(dataDir, ["Customer"], {
        requireId: true,
        requiredFieldsByType: { Customer: ["name", "email"] },
      }),
    ).toThrowError(`${jsonlPath}:2: field \`email\` is required with --upsert`);
  });
});
