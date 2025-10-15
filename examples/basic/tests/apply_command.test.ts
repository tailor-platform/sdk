import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { format as formatDate } from "date-fns";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tempDistDir = "tests/fixtures/actual";
console.info(`This test is running in directory: ${tempDistDir}`);

describe("pnpm apply command integration tests", () => {
  const expectedDir = path.join(__dirname, "fixtures/expected");
  const actualDir = path.join(__dirname, "fixtures/actual");

  const expectedGeneratedFilesWithContent = ["db.ts", "types.ts"] as const;
  const expectedGeneratedFiles = [
    "db.ts",
    "types.ts",
    "executor_steps/user-created.js",
    "executors/user-created.js",
    "executors/user-created.js.map",
    "executors/user-created.transformed.js",
    "functions/add__step1.js",
    "functions/add__step1.js.map",
    "functions/showUserInfo__step1.js",
    "functions/showUserInfo__step1.js.map",
    "functions/stepChain__kyselyStep.js",
    "functions/stepChain__kyselyStep.js.map",
    "functions/stepChain__sqlStep.js",
    "functions/stepChain__sqlStep.js.map",
    "functions/stepChain__step1.js",
    "functions/stepChain__step1.js.map",
    "functions/stepChain__step2.js",
    "functions/stepChain__step2.js.map",
    "resolvers/add.js",
    "resolvers/add.transformed.js",
    "resolvers/showUserInfo.js",
    "resolvers/showUserInfo.transformed.js",
    "resolvers/stepChain.js",
    "resolvers/stepChain.transformed.js",
    "steps/add__step1.js",
    "steps/showUserInfo__step1.js",
    "steps/stepChain__kyselyStep.js",
    "steps/stepChain__sqlStep.js",
    "steps/stepChain__step1.js",
    "steps/stepChain__step2.js",
  ] as const;

  const collectGeneratedFiles = (rootDir: string): string[] => {
    const files: string[] = [];

    const traverse = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === ".DS_Store") {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          traverse(fullPath);
        } else {
          const relativePath = path
            .relative(rootDir, fullPath)
            .split(path.sep)
            .join("/");
          files.push(relativePath);
        }
      }
    };

    traverse(rootDir);

    return files;
  };

  const fixedSystemTime = new Date("2025-10-06T12:34:56.000Z");
  const formatExpectation = formatDate(fixedSystemTime, "yyyy-MM-dd HH:mm:ss");

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedSystemTime);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  type MainFunction = (
    args: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  type QueryResolver = (query: string, params: unknown[]) => unknown[];

  const GlobalThis = globalThis as {
    main?: MainFunction;
    tailordb?: {
      Client: new (config: { namespace?: string }) => {
        connect(): Promise<void> | void;
        end(): Promise<void> | void;
        queryObject(
          query: string,
          params?: unknown[],
        ): Promise<{ rows: unknown[] }> | { rows: unknown[] };
      };
    };
  };

  const resetGlobals = () => {
    delete GlobalThis.main;
    delete GlobalThis.tailordb;
  };

  const setupTailordbMock = (
    resolver: QueryResolver = () => [],
  ): {
    executedQueries: { query: string; params: unknown[] }[];
    createdClients: { namespace?: string; ended: boolean }[];
  } => {
    const executedQueries: { query: string; params: unknown[] }[] = [];
    const createdClients: { namespace?: string; ended: boolean }[] = [];

    class MockTailordbClient {
      private record: { namespace?: string; ended: boolean };

      constructor({ namespace }: { namespace?: string }) {
        this.record = { namespace, ended: false };
        createdClients.push(this.record);
      }

      async connect(): Promise<void> {
        /* noop */
      }

      async end(): Promise<void> {
        this.record.ended = true;
      }

      async queryObject(
        query: string,
        params: unknown[] = [],
      ): Promise<{ rows: unknown[] }> {
        executedQueries.push({ query, params });
        const rows = resolver(query, params) ?? [];
        return { rows: Array.isArray(rows) ? rows : [] };
      }
    }

    GlobalThis.tailordb = {
      Client: MockTailordbClient,
    } as typeof GlobalThis.tailordb;

    return { executedQueries, createdClients };
  };

  const createImportMain =
    (baseDir: string) =>
    async (relativePath: string): Promise<MainFunction> => {
      resetGlobals();
      const fileUrl = pathToFileURL(path.join(baseDir, relativePath));
      fileUrl.searchParams.set("v", `${Date.now()}-${Math.random()}`);
      await import(fileUrl.href);
      expect(typeof GlobalThis.main).toBe("function");
      return GlobalThis.main!;
    };

  const importActualMain = createImportMain(actualDir);

  test("compare directory structure", () => {
    const actualFiles = collectGeneratedFiles(tempDistDir).sort();
    const expectedFiles = [...expectedGeneratedFiles].sort();

    expect(actualFiles).toEqual(expectedFiles);
  });

  test("generated ts files match expected snapshots", () => {
    for (const file of expectedGeneratedFilesWithContent) {
      const actualPath = path.join(actualDir, file);
      const expectedPath = path.join(expectedDir, file);
      const actual = fs.readFileSync(actualPath, "utf-8");
      const expected = fs.readFileSync(expectedPath, "utf-8");
      expect(
        actual,
        `Diff found in ${file}, check details with:\n  diff ${expectedPath} ${actualPath}`,
      ).toBe(expected);
    }
  });

  test("bundled JS files should not be excessively large", () => {
    // Define maximum acceptable sizes (2x current sizes as threshold)
    const maxSizes: Record<string, number> = {
      "executors/user-created.js": 18373 * 2, // ~36KB
      "functions/add__step1.js": 10168 * 2, // ~20KB
      "functions/showUserInfo__step1.js": 10435 * 2, // ~21KB
      "functions/stepChain__kyselyStep.js": 173573 * 2, // ~347KB
      "functions/stepChain__sqlStep.js": 173551 * 2, // ~347KB
      "functions/stepChain__step1.js": 173509 * 2, // ~347KB
      "functions/stepChain__step2.js": 173503 * 2, // ~347KB
    };

    for (const [file, maxSize] of Object.entries(maxSizes)) {
      const filePath = path.join(actualDir, file);
      const stats = fs.statSync(filePath);
      const actualSize = stats.size;

      expect(
        actualSize,
        `File ${file} is too large: ${actualSize} bytes (max: ${maxSize} bytes). This may indicate unwanted dependencies (e.g., zod) are being bundled.`,
      ).toBeLessThanOrEqual(maxSize);
    }
  });

  describe("globalThis.main test", () => {
    describe("resolvers", () => {
      test("functions/add__step1.js returns the sum of inputs", async () => {
        const main = await importActualMain("functions/add__step1.js");
        const result = await main({ input: { a: 4, b: 6 } });
        expect(result).toBe(10);
      });

      test("functions/showUserInfo__step1.js returns user information", async () => {
        const main = await importActualMain("functions/showUserInfo__step1.js");
        const payload = {
          user: {
            id: "57485cfe-fc74-4d46-8660-f0e95d1fbf98",
            type: "machine_user",
            workspaceId: "b39bdd61-d442-4a4e-8599-33a78a4e19ab",
            attributes: { role: "ADMIN" },
          },
        };
        const result = await main(payload);
        expect(result).toEqual({
          id: "57485cfe-fc74-4d46-8660-f0e95d1fbf98",
          type: "machine_user",
          workspaceId: "b39bdd61-d442-4a4e-8599-33a78a4e19ab",
          role: "ADMIN",
        });
      });

      test("functions/stepChain__step1.js returns a message containing the user's name", async () => {
        const main = await importActualMain("functions/stepChain__step1.js");
        setupTailordbMock();
        const result = await main({
          input: {
            user: {
              name: { first: "Taro", last: "Yamada" },
              activatedAt: null,
            },
          },
        });
        expect(result).toBe("step1: Hello Taro Yamada on step1!");
      });

      test("functions/stepChain__step2.js returns a formatted date string", async () => {
        const main = await importActualMain("functions/stepChain__step2.js");
        setupTailordbMock();
        const result = await main({});
        expect(result).toBe(`step2: recorded ${formatExpectation} on step2!`);
      });

      test("functions/stepChain__sqlStep.js returns the name from the query result", async () => {
        const main = await importActualMain("functions/stepChain__sqlStep.js");
        setupTailordbMock((query) => {
          if (typeof query === "string") {
            const normalizedQuery = query.replace(/["`]/g, "").toUpperCase();
            if (
              normalizedQuery.includes(
                "SELECT NAME FROM USER ORDER BY CREATEDAT DESC",
              )
            ) {
              return [{ name: "Alice" }];
            }
          }
          return [];
        });
        const result = await main({});
        expect(result).toBe("Alice");
      });

      test("functions/stepChain__kyselyStep.js returns the combined state from the query result", async () => {
        const main = await importActualMain(
          "functions/stepChain__kyselyStep.js",
        );
        setupTailordbMock((query) => {
          if (typeof query === "string") {
            const normalizedQuery = query.replace(/["`]/g, "").toUpperCase();
            if (normalizedQuery.includes("SELECT STATE FROM SUPPLIER")) {
              return [{ state: "CA" }, { state: "NY" }];
            }
          }
          return [];
        });
        const result = await main({});
        expect(result).toBe("CA, NY");
      });
    });

    describe("executors", () => {
      test("executors/user-created.js uses the tailordb client", async () => {
        const main = await importActualMain("executors/user-created.js");
        const { executedQueries, createdClients } = setupTailordbMock(
          (query, params) => {
            if (query.includes("select * from User where id = ?")) {
              expect(params).toEqual(["user-1"]);
              return [
                {
                  name: "Expected User",
                  email: "expected@tailor.tech",
                },
              ];
            }
            return [];
          },
        );
        const payload = { newRecord: { id: "user-1" } };
        const result = await main(payload);

        expect(result).toBeUndefined();
        expect(executedQueries).toEqual([
          { query: "select * from User where id = ?", params: ["user-1"] },
        ]);
        expect(createdClients).toEqual([
          { namespace: "tailordb", ended: true },
        ]);
      });
    });
  });
});
