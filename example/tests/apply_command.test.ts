import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { format as formatDate } from "date-fns";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const tempDistDir = "tests/fixtures/actual";

describe("pnpm apply command integration tests", () => {
  const expectedDir = path.join(__dirname, "fixtures/expected");
  const actualDir = path.join(__dirname, "fixtures/actual");

  const expectedGeneratedFilesWithContent = ["db.ts"] as const;
  const expectedGeneratedFiles = [
    "db.ts",
    // Executor bundler creates entry files (.entry.js) in same directory as output files
    "executors/user-created.entry.js",
    "executors/user-created.js",
    "executors/user-created.js.map",
    // Resolver bundler creates entry files (.entry.js) in same directory as output files
    "resolvers/add.entry.js",
    "resolvers/add.js",
    "resolvers/add.js.map",
    "resolvers/env.entry.js",
    "resolvers/env.js",
    "resolvers/env.js.map",
    "resolvers/passThrough.entry.js",
    "resolvers/passThrough.js",
    "resolvers/passThrough.js.map",
    "resolvers/showUserInfo.entry.js",
    "resolvers/showUserInfo.js",
    "resolvers/showUserInfo.js.map",
    "resolvers/stepChain.entry.js",
    "resolvers/stepChain.js",
    "resolvers/stepChain.js.map",
    // Workflow bundler creates entry files (.entry.js) in same directory as output files
    "workflow-jobs/check-inventory.entry.js",
    "workflow-jobs/check-inventory.js",
    "workflow-jobs/check-inventory.js.map",
    "workflow-jobs/fetch-customer.entry.js",
    "workflow-jobs/fetch-customer.js",
    "workflow-jobs/fetch-customer.js.map",
    "workflow-jobs/process-order.entry.js",
    "workflow-jobs/process-order.js",
    "workflow-jobs/process-order.js.map",
    "workflow-jobs/process-payment.entry.js",
    "workflow-jobs/process-payment.js",
    "workflow-jobs/process-payment.js.map",
    "workflow-jobs/send-notification.entry.js",
    "workflow-jobs/send-notification.js",
    "workflow-jobs/send-notification.js.map",
    "workflow-jobs/validate-order.entry.js",
    "workflow-jobs/validate-order.js",
    "workflow-jobs/validate-order.js.map",
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
    setupTailordbMock();
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
    tailor?: {
      workflow: {
        triggerJobFunction: (
          jobName: string,
          args: unknown,
        ) => Promise<unknown>;
      };
    };
  };

  const resetGlobals = () => {
    delete GlobalThis.main;
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
    // Define maximum acceptable sizes (current size + 10KB)
    const sizeBuffer = 1024 * 10; // 10KB
    const maxSizes: Record<string, number> = {
      "executors/user-created.js": 162223 + sizeBuffer,
      "resolvers/add.js": 4504 + sizeBuffer,
      "resolvers/showUserInfo.js": 4588 + sizeBuffer,
      "resolvers/stepChain.js": 176907 + sizeBuffer,
      // workflow-jobs: Kysely jobs (~160KB), date-fns jobs (~28KB), simple jobs (~9KB)
      "workflow-jobs/check-inventory.js": 28058 + sizeBuffer,
      "workflow-jobs/fetch-customer.js": 160819 + sizeBuffer,
      "workflow-jobs/process-order.js": 8755 + sizeBuffer,
      "workflow-jobs/process-payment.js": 160816 + sizeBuffer,
      "workflow-jobs/send-notification.js": 28162 + sizeBuffer,
      "workflow-jobs/validate-order.js": 8554 + sizeBuffer,
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

  describe("validation", () => {
    test("resolvers/add.js validates input correctly - valid values", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Valid values: both a and b are >= 0 and < 10
      await expect(main({ input: { a: 4, b: 6 } })).resolves.not.toThrow();
    });

    test("resolvers/add.js validates input correctly - negative value throws error with correct message", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Invalid: a is negative (fails validation: value >= 0)
      await expect(main({ input: { a: -1, b: 5 } })).rejects.toThrow(
        "a: Value must be non-negative",
      );
    });

    test("resolvers/add.js validates input correctly - value >= 10 throws error with correct message", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Invalid: a is >= 10 (fails validation: value < 10)
      await expect(main({ input: { a: 10, b: 5 } })).rejects.toThrow(
        "a: Value must be less than 10",
      );
    });

    test("resolvers/add.js validates input correctly - b negative throws error with correct message", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Invalid: b is negative
      await expect(main({ input: { a: 5, b: -2 } })).rejects.toThrow(
        "b: Value must be non-negative",
      );
    });

    test("resolvers/add.js validates input correctly - b >= 10 throws error with correct message", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Invalid: b is >= 10
      await expect(main({ input: { a: 5, b: 15 } })).rejects.toThrow(
        "b: Value must be less than 10",
      );
    });

    test("resolvers/add.js validates input correctly - multiple fields with errors show all errors", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Invalid: both a and b are negative
      await expect(main({ input: { a: -1, b: -2 } })).rejects.toThrow(
        [
          "Failed to input validation:",
          "  a: Value must be non-negative",
          "  b: Value must be non-negative",
        ].join("\n"),
      );
    });

    test("resolvers/add.js validates input correctly - multiple validation errors per field", async () => {
      const main = await importActualMain("resolvers/add.js");

      // Invalid: both a and b are >= 10
      await expect(main({ input: { a: 10, b: 15 } })).rejects.toThrow(
        [
          "Failed to input validation:",
          "  a: Value must be less than 10",
          "  b: Value must be less than 10",
        ].join("\n"),
      );
    });

    test("resolvers/stepChain.js validates nested fields - valid values", async () => {
      setupTailordbMock((query) => {
        if (typeof query === "string") {
          const normalizedQuery = query.replace(/["`]/g, "").toUpperCase();
          if (normalizedQuery.includes("SELECT STATE FROM SUPPLIER")) {
            return [{ state: "CA" }];
          }
        }
        return [];
      });

      const main = await importActualMain("resolvers/stepChain.js");

      // Valid nested values: first and last names are both >= 2 characters
      await expect(
        main({
          input: {
            user: {
              name: { first: "Taro", last: "Yamada" },
              activatedAt: null,
            },
          },
          user: {
            id: "test-user-id",
            type: "user",
            workspaceId: "test-workspace-id",
          },
        }),
      ).resolves.not.toThrow();
    });

    test("resolvers/stepChain.js validates nested fields - invalid first name", async () => {
      const main = await importActualMain("resolvers/stepChain.js");

      // Invalid: first name is too short (< 2 characters)
      await expect(
        main({
          input: {
            user: {
              name: { first: "T", last: "Yamada" },
              activatedAt: null,
            },
          },
          user: {
            id: "test-user-id",
            type: "user",
            workspaceId: "test-workspace-id",
          },
        }),
      ).rejects.toThrow(
        "user.name.first: First name must be at least 2 characters",
      );
    });

    test("resolvers/stepChain.js validates nested fields - invalid last name", async () => {
      const main = await importActualMain("resolvers/stepChain.js");

      // Invalid: last name is too short (< 2 characters)
      await expect(
        main({
          input: {
            user: {
              name: { first: "Taro", last: "Y" },
              activatedAt: null,
            },
          },
          user: {
            id: "test-user-id",
            type: "user",
            workspaceId: "test-workspace-id",
          },
        }),
      ).rejects.toThrow(
        "user.name.last: Last name must be at least 2 characters",
      );
    });

    test("resolvers/stepChain.js validates nested fields - multiple nested fields invalid", async () => {
      const main = await importActualMain("resolvers/stepChain.js");

      // Invalid: both first and last names are too short
      await expect(
        main({
          input: {
            user: {
              name: { first: "T", last: "Y" },
              activatedAt: null,
            },
          },
          user: {
            id: "test-user-id",
            type: "user",
            workspaceId: "test-workspace-id",
          },
        }),
      ).rejects.toThrow(
        [
          "Failed to input validation:",
          "  user.name.first: First name must be at least 2 characters",
          "  user.name.last: Last name must be at least 2 characters",
        ].join("\n"),
      );
    });
  });

  describe("globalThis.main test", () => {
    describe("resolvers", () => {
      test("resolvers/add.js returns the sum of inputs", async () => {
        const main = await importActualMain("resolvers/add.js");
        const result = await main({ input: { a: 4, b: 6 } });
        expect(result).toEqual(10);
      });

      test("resolvers/showUserInfo.js returns user information", async () => {
        const main = await importActualMain("resolvers/showUserInfo.js");
        const payload = {
          user: {
            id: "57485cfe-fc74-4d46-8660-f0e95d1fbf98",
            type: "machine_user",
            workspaceId: "b39bdd61-d442-4a4e-8599-33a78a4e19ab",
            attributes: { role: "MANAGER" },
          },
        };
        const result = await main(payload);
        expect(result).toEqual({
          id: "57485cfe-fc74-4d46-8660-f0e95d1fbf98",
          type: "machine_user",
          workspaceId: "b39bdd61-d442-4a4e-8599-33a78a4e19ab",
          role: "MANAGER",
        });
      });

      test("resolvers/stepChain.js returns result with summary", async () => {
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
            if (normalizedQuery.includes("SELECT STATE FROM SUPPLIER")) {
              return [{ state: "CA" }, { state: "NY" }];
            }
          }
          return [];
        });

        const main = await importActualMain("resolvers/stepChain.js");
        const result = await main({
          input: {
            user: {
              name: { first: "Taro", last: "Yamada" },
              activatedAt: null,
            },
          },
          user: {
            id: "test-user-id",
            type: "user",
            workspaceId: "test-workspace-id",
          },
        });
        expect(result).toEqual({
          result: {
            summary: [
              "step1: Hello Taro Yamada on step1!",
              `step2: recorded ${formatExpectation} on step2!`,
              "CA, NY",
            ],
          },
        });
      });
    });

    describe("executors", () => {
      test("executors/user-created.js uses the tailordb client", async () => {
        const { executedQueries, createdClients } = setupTailordbMock(
          (query, params) => {
            if (query.includes("select * from User where id = $1")) {
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

        const main = await importActualMain("executors/user-created.js");
        const payload = { newRecord: { id: "user-1" } };
        const result = await main(payload);

        expect(result).toBeUndefined();
        expect(executedQueries).toEqual([
          { query: 'select * from "User" where "id" = $1', params: ["user-1"] },
        ]);
        expect(createdClients).toMatchObject([{ namespace: "tailordb" }]);
      });
    });

    describe("workflow-jobs", () => {
      type JobHandler = (
        jobName: string,
        args: unknown,
      ) => Promise<unknown> | unknown;

      const setupWorkflowMock = (
        handler: JobHandler,
      ): { triggeredJobs: { jobName: string; args: unknown }[] } => {
        const triggeredJobs: { jobName: string; args: unknown }[] = [];

        GlobalThis.tailor = {
          workflow: {
            triggerJobFunction: async (jobName: string, args: unknown) => {
              triggeredJobs.push({ jobName, args });
              return handler(jobName, args);
            },
          },
        } as typeof GlobalThis.tailor;

        return { triggeredJobs };
      };

      test("workflow-jobs/process-order.js calls dependent jobs correctly", async () => {
        const { triggeredJobs } = setupWorkflowMock((jobName, args) => {
          if (jobName === "fetch-customer") {
            const { customerId } = args as { customerId: string };
            return { id: customerId, email: "customer@example.com" };
          }
          if (jobName === "send-notification") {
            return { sent: true, timestamp: "2025-01-01 12:00:00" };
          }
          return null;
        });

        const main = await importActualMain("workflow-jobs/process-order.js");
        const result = await main({
          orderId: "order-123",
          customerId: "customer-456",
        });

        expect(result).toEqual({
          orderId: "order-123",
          customerId: "customer-456",
          customerEmail: "customer@example.com",
          notificationSent: true,
          processedAt: "2025-01-01 12:00:00",
        });

        expect(triggeredJobs).toEqual([
          { jobName: "fetch-customer", args: { customerId: "customer-456" } },
          {
            jobName: "send-notification",
            args: {
              message: "Your order order-123 is being processed",
              recipient: "customer@example.com",
            },
          },
        ]);
      });

      test("workflow-jobs/process-order.js throws error when customer not found", async () => {
        setupWorkflowMock((jobName) => {
          if (jobName === "fetch-customer") {
            return null; // Customer not found
          }
          return null;
        });

        const main = await importActualMain("workflow-jobs/process-order.js");

        await expect(
          main({
            orderId: "order-123",
            customerId: "non-existent",
          }),
        ).rejects.toThrow("Customer non-existent not found");
      });

      test("workflow-jobs/send-notification.js executes correctly", async () => {
        const main = await importActualMain(
          "workflow-jobs/send-notification.js",
        );
        const result = await main({
          message: "Test message",
          recipient: "test@example.com",
        });

        expect(result).toMatchObject({
          sent: true,
          timestamp: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
        });
      });
    });
  });
});
