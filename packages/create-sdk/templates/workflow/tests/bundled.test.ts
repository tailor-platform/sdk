import path from "node:path";
import {
  createImportMain,
  setupInvokerMock,
  setupTailordbMock,
  setupWorkflowMock,
} from "@tailor-platform/sdk/test";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const outputDir = path.join(__dirname, "../.tailor-sdk");

describe("bundled workflow execution", () => {
  let executedQueries: { query: string; params: unknown[] }[];

  const importMain = createImportMain(outputDir);

  beforeAll(() => {
    ({ executedQueries } = setupTailordbMock());
    setupInvokerMock(null);
  });

  beforeEach(() => {
    executedQueries.length = 0;
  });

  describe("sync-profile job", () => {
    test("creates new user when not found", async () => {
      let selectCalled = false;
      setupTailordbMock((query) => {
        if (query.includes("SELECT") || query.includes("select")) {
          if (!selectCalled) {
            selectCalled = true;
            return [];
          }
        }
        if (query.includes("INSERT") || query.includes("insert")) {
          return [
            {
              id: "new-id",
              name: "Alice",
              email: "alice@example.com",
              age: 25,
              createdAt: "2024-01-01",
              updatedAt: null,
            },
          ];
        }
        return [];
      });

      const main = await importMain("workflow-jobs/sync-profile.js");
      const result = await main({ name: "Alice", email: "alice@example.com", age: 25 });
      expect(result).toEqual({
        created: true,
        profile: { name: "Alice", email: "alice@example.com", age: 25 },
      });
    });

    test("updates existing user when found", async () => {
      setupTailordbMock((query) => {
        if (query.includes("SELECT") || query.includes("select")) {
          return [
            {
              id: "existing-id",
              name: "Old Name",
              email: "alice@example.com",
              age: 20,
              createdAt: "2024-01-01",
              updatedAt: null,
            },
          ];
        }
        return [];
      });

      const main = await importMain("workflow-jobs/sync-profile.js");
      const result = await main({ name: "Alice Updated", email: "alice@example.com", age: 26 });
      expect(result).toEqual({
        created: false,
        profile: { name: "Alice Updated", email: "alice@example.com", age: 26 },
      });
    });
  });

  describe("order-fulfillment jobs", () => {
    test("validate-order validates positive amount", async () => {
      const main = await importMain("workflow-jobs/validate-order.js");
      const result = await main({ orderId: "order-1", amount: 100 });
      expect(result).toEqual({ valid: true, orderId: "order-1" });
    });

    test("validate-order throws for non-positive amount", async () => {
      const main = await importMain("workflow-jobs/validate-order.js");
      await expect(main({ orderId: "order-1", amount: 0 })).rejects.toThrow(
        "Order amount must be positive",
      );
    });

    test("process-payment returns transaction", async () => {
      const main = await importMain("workflow-jobs/process-payment.js");
      const result = await main({ orderId: "order-1", amount: 100 });
      expect(result).toEqual({
        transactionId: "txn-order-1",
        amount: 100,
        status: "completed",
      });
    });

    test("send-confirmation returns confirmation", async () => {
      const main = await importMain("workflow-jobs/send-confirmation.js");
      const result = await main({ orderId: "order-1", transactionId: "txn-order-1" });
      expect(result).toEqual({
        orderId: "order-1",
        transactionId: "txn-order-1",
        confirmed: true,
      });
    });

    test("fulfill-order orchestrates all jobs", async () => {
      setupWorkflowMock((jobName, args) => {
        switch (jobName) {
          case "validate-order":
            return { valid: true, orderId: (args as { orderId: string }).orderId };
          case "process-payment":
            return {
              transactionId: `txn-${(args as { orderId: string }).orderId}`,
              amount: (args as { amount: number }).amount,
              status: "completed",
            };
          case "send-confirmation":
            return {
              orderId: (args as { orderId: string }).orderId,
              transactionId: (args as { transactionId: string }).transactionId,
              confirmed: true,
            };
          default:
            throw new Error(`Unknown job: ${jobName}`);
        }
      });

      const main = await importMain("workflow-jobs/fulfill-order.js");
      const result = await main({ orderId: "order-1", amount: 100 });
      expect(result).toEqual({
        orderId: "order-1",
        transactionId: "txn-order-1",
        confirmed: true,
        paymentStatus: "completed",
      });
    });
  });
});
