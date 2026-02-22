import { describe, expect, test } from "vitest";
import path from "node:path";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("004-workflow-data-pipeline", () => {
  // ---------------------------------------------------------------------------
  // validateInput
  // ---------------------------------------------------------------------------
  describe("validateInput", () => {
    test("job name is validate-input", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      expect(mod.validateInput.name).toBe("validate-input");
    });

    test("valid input returns valid true with no errors", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "user@example.com",
        amount: 100,
        items: [{ name: "Widget", price: 10 }],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test("invalid email without @ returns error", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "invalid-email",
        amount: 100,
        items: [{ name: "Widget", price: 10 }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("email");
    });

    test("amount <= 0 returns error", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "user@example.com",
        amount: -5,
        items: [{ name: "Widget", price: 10 }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("amount");
    });

    test("empty items returns error", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "user@example.com",
        amount: 100,
        items: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("items");
    });

    test("collects all errors without short-circuiting", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "invalid",
        amount: 0,
        items: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });

    test("amount exactly 0 is invalid", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "user@example.com",
        amount: 0,
        items: [{ name: "Widget", price: 10 }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e: string) => e.toLowerCase().includes("amount"))).toBe(true);
    });

    test("valid email with other invalid fields collects all errors", async () => {
      const mod = await importPath(path.join(workDir, "workflows/validateInput.ts"));
      const result = mod.validateInput.body({
        email: "user@example.com",
        amount: -1,
        items: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // enrichData
  // ---------------------------------------------------------------------------
  describe("enrichData", () => {
    test("job name is enrich-data", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      expect(mod.enrichData.name).toBe("enrich-data");
    });

    test("itemCount matches number of items", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      const result = mod.enrichData.body({
        email: "test@test.com",
        amount: 100,
        items: [
          { name: "A", price: 10 },
          { name: "B", price: 20 },
        ],
      });
      expect(result.itemCount).toBe(2);
    });

    test("averagePrice calculated correctly for multiple items", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      const result = mod.enrichData.body({
        email: "test@test.com",
        amount: 500,
        items: [
          { name: "A", price: 10 },
          { name: "B", price: 20 },
          { name: "C", price: 30 },
        ],
      });
      expect(result.averagePrice).toBeCloseTo(20);
      expect(result.itemCount).toBe(3);
    });

    test("averagePrice with single item", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      const result = mod.enrichData.body({
        email: "test@test.com",
        amount: 100,
        items: [{ name: "A", price: 42 }],
      });
      expect(result.averagePrice).toBeCloseTo(42);
    });

    test("priority is high when amount >= 1000", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      const result = mod.enrichData.body({
        email: "test@test.com",
        amount: 1000,
        items: [{ name: "A", price: 10 }],
      });
      expect(result.priority).toBe("high");
    });

    test("priority is medium when amount >= 100 and < 1000", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      const result = mod.enrichData.body({
        email: "test@test.com",
        amount: 500,
        items: [{ name: "A", price: 10 }],
      });
      expect(result.priority).toBe("medium");
    });

    test("priority is low when amount < 100", async () => {
      const mod = await importPath(path.join(workDir, "workflows/enrichData.ts"));
      const result = mod.enrichData.body({
        email: "test@test.com",
        amount: 50,
        items: [{ name: "A", price: 10 }],
      });
      expect(result.priority).toBe("low");
    });
  });

  // ---------------------------------------------------------------------------
  // processPayment
  // ---------------------------------------------------------------------------
  describe("processPayment", () => {
    test("job name is process-payment", async () => {
      const mod = await importPath(path.join(workDir, "workflows/processPayment.ts"));
      expect(mod.processPayment.name).toBe("process-payment");
    });

    test("transactionId contains amount and priority", async () => {
      const mod = await importPath(path.join(workDir, "workflows/processPayment.ts"));
      const result = mod.processPayment.body({
        email: "user@example.com",
        amount: 500,
        priority: "medium",
      });
      expect(result.transactionId).toContain("500");
      expect(result.transactionId).toContain("medium");
    });

    test("status is always completed", async () => {
      const mod = await importPath(path.join(workDir, "workflows/processPayment.ts"));
      const result = mod.processPayment.body({
        email: "user@example.com",
        amount: 100,
        priority: "low",
      });
      expect(result.status).toBe("completed");
    });
  });

  // ---------------------------------------------------------------------------
  // orchestrate + sendConfirmation
  // ---------------------------------------------------------------------------
  describe("orchestrate module structure", () => {
    test("sendConfirmation job name is send-confirmation", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      expect(mod.sendConfirmation.name).toBe("send-confirmation");
    });

    test("orchestrate job name is orchestrate-pipeline", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      expect(mod.orchestrate.name).toBe("orchestrate-pipeline");
    });

    test("workflow name is order-pipeline", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      expect(mod.default.name).toBe("order-pipeline");
    });

    test("has default export (workflow)", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      expect(mod.default).toBeDefined();
      expect(mod.default.name).toBeDefined();
      expect(mod.default.mainJob).toBeDefined();
    });

    test("all 5 jobs are named exports", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      expect(mod.sendConfirmation).toBeDefined();
      expect(mod.orchestrate).toBeDefined();
      expect(mod.validateInput).toBeDefined();
      expect(mod.enrichData).toBeDefined();
      expect(mod.processPayment).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // orchestration end-to-end (trigger calls body directly in SDK)
  // ---------------------------------------------------------------------------
  describe("orchestration end-to-end", () => {
    test("valid input returns success with enriched, payment, and confirmation", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      const result = await mod.orchestrate.body({
        email: "user@example.com",
        amount: 500,
        items: [{ name: "Widget", price: 25 }],
      });
      expect(result.success).toBe(true);
      expect(result.enriched).toBeDefined();
      expect(result.enriched.itemCount).toBe(1);
      expect(result.enriched.averagePrice).toBeCloseTo(25);
      expect(result.enriched.priority).toBe("medium");
      expect(result.payment).toBeDefined();
      expect(result.payment.transactionId).toContain("500");
      expect(result.payment.status).toBe("completed");
      expect(result.confirmation).toBeDefined();
      expect(result.confirmation.sent).toBe(true);
      expect(result.confirmation.recipient).toBe("user@example.com");
    });

    test("high-value order gets high priority", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      const result = await mod.orchestrate.body({
        email: "user@example.com",
        amount: 2000,
        items: [{ name: "Laptop", price: 1500 }],
      });
      expect(result.success).toBe(true);
      expect(result.enriched.priority).toBe("high");
    });

    test("invalid input returns success false with errors", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      const result = await mod.orchestrate.body({
        email: "invalid",
        amount: 0,
        items: [],
      });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("validation failure short-circuits (no enriched/payment/confirmation)", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      const result = await mod.orchestrate.body({
        email: "invalid",
        amount: -1,
        items: [],
      });
      expect(result.success).toBe(false);
      expect(result.enriched).toBeUndefined();
      expect(result.payment).toBeUndefined();
      expect(result.confirmation).toBeUndefined();
    });

    test("orchestrate module has default export", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orchestrate.ts"));
      expect(mod.default).toBeDefined();
    });
  });
});
