import fs from "node:fs";
import path from "node:path";
import { setupTailordbMock, setupWorkflowMock } from "@tailor-platform/sdk/test";
import { format as formatDate } from "date-fns";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createImportMain } from "./createImportMain";

describe("bundled execution tests", () => {
  const actualDir = path.join(__dirname, "fixtures/plugins");

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

  const importActualMain = createImportMain(actualDir);

  test("bundled JS files should not be excessively large", () => {
    // Define maximum acceptable sizes (current size + 10KB buffer)
    const sizeBuffer = 1024 * 10; // 10KB
    const maxSizes: Record<string, number> = {
      "executors/user-created.js": 162223 + sizeBuffer,
      "resolvers/add.js": 4504 + sizeBuffer,
      "resolvers/showUserInfo.js": 4588 + sizeBuffer,
      "resolvers/stepChain.js": 176907 + sizeBuffer,
      // triggerOrderProcessing: imports auth from tailor.config (~14KB)
      "resolvers/triggerOrderProcessing.js": 14022 + sizeBuffer,
      // workflow-jobs: Kysely jobs (~160KB), date-fns jobs (~28KB), simple jobs (~9KB)
      "workflow-jobs/check-inventory.js": 28058 + sizeBuffer,
      "workflow-jobs/fetch-customer.js": 160819 + sizeBuffer,
      "workflow-jobs/process-order.js": 8755 + sizeBuffer,
      "workflow-jobs/process-payment.js": 160729 + sizeBuffer,
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
        const normalizedQuery = query.replace(/["`]/g, "").toUpperCase();
        if (normalizedQuery.includes("SELECT NAME FROM USER ORDER BY CREATEDAT DESC")) {
          return [{ name: "Alice" }];
        }
        if (normalizedQuery.includes("SELECT STATE FROM SUPPLIER")) {
          return [{ state: "CA" }, { state: "NY" }];
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
      const { executedQueries, createdClients } = setupTailordbMock((query, params) => {
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
      });

      const main = await importActualMain("executors/user-created.js");
      const payload = { newRecord: { id: "user-1" } };
      const result = await main(payload);

      expect(result).toBeUndefined();
      expect(executedQueries).toEqual([
        { query: 'select * from "User" where "id" = $1', params: ["user-1"] },
        {
          query: 'insert into "UserLog" ("userID", "message") values ($1, $2)',
          params: ["user-1", "User created: undefined (undefined)"],
        },
      ]);
      expect(createdClients).toMatchObject([{ namespace: "tailordb" }]);
    });
  });

  describe("workflow-jobs", () => {
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
      setupWorkflowMock(() => null);

      const main = await importActualMain("workflow-jobs/process-order.js");

      await expect(
        main({
          orderId: "order-123",
          customerId: "non-existent",
        }),
      ).rejects.toThrow("Customer non-existent not found");
    });

    test("workflow-jobs/send-notification.js executes correctly", async () => {
      const main = await importActualMain("workflow-jobs/send-notification.js");
      const result = await main({
        message: "Test message",
        recipient: "test@example.com",
      });

      expect(result).toMatchObject({
        sent: true,
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      });
    });

    test("workflow-jobs entry files contain env variables from config", () => {
      const entryFiles = [
        "workflow-jobs/fetch-customer.entry.js",
        "workflow-jobs/process-order.entry.js",
        "workflow-jobs/send-notification.entry.js",
      ];

      for (const file of entryFiles) {
        const content = fs.readFileSync(path.join(actualDir, file), "utf-8");
        expect(content).toContain('const env = {"foo":1,"bar":"hello","baz":true}');
        expect(content).toMatch(/\.body\(input, \{ env \}\)/);
      }
    });

    test("workflow-jobs/validate-order.js triggers check-inventory job", async () => {
      const { triggeredJobs } = setupWorkflowMock((jobName) => {
        if (jobName === "check-inventory") {
          return formatExpectation;
        }
        return null;
      });

      const main = await importActualMain("workflow-jobs/validate-order.js");
      const result = await main({ orderId: "order-789" });

      expect(result).toEqual({
        inventoryResult: formatExpectation,
        paymentResult: null,
      });

      expect(triggeredJobs).toEqual([
        { jobName: "check-inventory", args: undefined },
        { jobName: "process-payment", args: undefined },
      ]);
    });

    test("workflow-jobs/check-inventory.js returns formatted date", async () => {
      const main = await importActualMain("workflow-jobs/check-inventory.js");
      const result = await main({});

      expect(result).toBe(formatExpectation);
    });
  });
});
