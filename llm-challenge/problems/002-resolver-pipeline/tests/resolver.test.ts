import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";
import { setupTailordbMock, cleanupMocks } from "../../../shared/mocks.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("002-resolver-pipeline", () => {
  // ---------------------------------------------------------------------------
  // pricingCalculator
  // ---------------------------------------------------------------------------
  describe("pricingCalculator", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let resolver: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "resolvers/pricingCalculator.ts"));
      resolver = mod.default;
    });

    test("name is pricingCalculator", () => {
      expect(resolver.name).toBe("pricingCalculator");
    });

    test("operation is mutation", () => {
      expect(resolver.operation).toBe("mutation");
    });

    test("input has items, couponCode, memberRank", () => {
      expect(resolver.input).toHaveProperty("items");
      expect(resolver.input).toHaveProperty("couponCode");
      expect(resolver.input).toHaveProperty("memberRank");
    });

    test("output has subtotal, discountedSubtotal, finalTotal, itemCount", () => {
      const fields = resolver.output.fields;
      expect(fields).toHaveProperty("subtotal");
      expect(fields).toHaveProperty("discountedSubtotal");
      expect(fields).toHaveProperty("finalTotal");
      expect(fields).toHaveProperty("itemCount");
    });

    test("empty items returns all zeros", () => {
      const result = resolver.body({
        input: { items: [] },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result).toEqual({ subtotal: 0, discountedSubtotal: 0, finalTotal: 0, itemCount: 0 });
    });

    test("single item no discount", () => {
      const result = resolver.body({
        input: { items: [{ name: "A", unitPrice: 100, quantity: 2 }] },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(200);
      expect(result.discountedSubtotal).toBe(200);
      expect(result.finalTotal).toBe(200);
      expect(result.itemCount).toBe(2);
    });

    test("multiple items subtotal", () => {
      const result = resolver.body({
        input: {
          items: [
            { name: "A", unitPrice: 10, quantity: 3 },
            { name: "B", unitPrice: 20, quantity: 1 },
          ],
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(50);
    });

    test("SAVE10 coupon applies 10% discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          couponCode: "SAVE10",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(100);
      expect(result.discountedSubtotal).toBe(90);
    });

    test("SAVE20 coupon applies 20% discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          couponCode: "SAVE20",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(100);
      expect(result.discountedSubtotal).toBe(80);
    });

    test("unknown coupon applies no discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          couponCode: "INVALID",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(100);
      expect(result.discountedSubtotal).toBe(100);
    });

    test("silver rank applies 5% discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          memberRank: "silver",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.discountedSubtotal).toBe(100);
      expect(result.finalTotal).toBe(95);
    });

    test("gold rank applies 10% discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          memberRank: "gold",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.finalTotal).toBe(90);
    });

    test("platinum rank applies 15% discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          memberRank: "platinum",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.finalTotal).toBe(85);
    });

    test("combined SAVE20 + gold discount", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          couponCode: "SAVE20",
          memberRank: "gold",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(100);
      expect(result.discountedSubtotal).toBe(80);
      expect(result.finalTotal).toBe(72);
    });

    test("negative total is clamped to 0", () => {
      // Use body directly with a negative unitPrice to force negative total
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: -100, quantity: 1 }],
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.finalTotal).toBe(0);
    });

    test("itemCount sums quantities across items", () => {
      const result = resolver.body({
        input: {
          items: [
            { name: "A", unitPrice: 10, quantity: 3 },
            { name: "B", unitPrice: 20, quantity: 5 },
            { name: "C", unitPrice: 5, quantity: 2 },
          ],
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.itemCount).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // lookupInventory
  // ---------------------------------------------------------------------------
  describe("lookupInventory", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let resolver: Record<string, any>;

    beforeAll(async () => {
      setupTailordbMock((query, _params) => {
        // Extract the WHERE clause to distinguish filters from SELECT columns.
        // Kysely generates lowercase SQL: where "category" = $1
        const lowerQuery = query.toLowerCase();
        const whereIdx = lowerQuery.indexOf(" where ");
        const whereClause = whereIdx >= 0 ? query.slice(whereIdx) : "";
        const hasCategory = whereClause.includes("category");
        const hasStock = whereClause.includes("stock");
        if (hasCategory && hasStock) {
          return [{ id: "1", name: "Widget", category: "electronics", stock: 10, price: 29.99 }];
        }
        if (hasCategory) {
          return [{ id: "1", name: "Widget", category: "electronics", stock: 10, price: 29.99 }];
        }
        if (hasStock) {
          return [
            { id: "1", name: "Widget", category: "electronics", stock: 10, price: 29.99 },
            { id: "2", name: "Gadget", category: "clothing", stock: 5, price: 49.99 },
          ];
        }
        return [
          { id: "1", name: "Widget", category: "electronics", stock: 10, price: 29.99 },
          { id: "2", name: "Gadget", category: "clothing", stock: 5, price: 49.99 },
        ];
      });

      const mod = await importPath(path.join(workDir, "resolvers/lookupInventory/resolver.ts"));
      resolver = mod.default;
    });

    afterAll(() => {
      cleanupMocks();
    });

    test("name is lookupInventory", () => {
      expect(resolver.name).toBe("lookupInventory");
    });

    test("operation is query", () => {
      expect(resolver.operation).toBe("query");
    });

    test("no filters returns all items", async () => {
      const result = await resolver.body({
        input: {},
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.items).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    test("category filter returns filtered results", async () => {
      const result = await resolver.body({
        input: { category: "electronics" },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe("electronics");
    });

    test("minStock filter returns filtered results", async () => {
      const result = await resolver.body({
        input: { minStock: 3 },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.items).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    test("both filters applied together", async () => {
      const result = await resolver.body({
        input: { category: "electronics", minStock: 5 },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.items).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    test("empty result returns items [] and count 0", async () => {
      // Set up a mock that returns empty for a specific category
      cleanupMocks();
      setupTailordbMock(() => []);
      // Re-import to pick up new mock
      const mod = await importPath(path.join(workDir, "resolvers/lookupInventory/resolver.ts"));
      const freshResolver = mod.default;
      const result = await freshResolver.body({
        input: { category: "nonexistent" },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.items).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // auditAction
  // ---------------------------------------------------------------------------
  describe("auditAction", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let resolver: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "resolvers/auditAction.ts"));
      resolver = mod.default;
    });

    test("name is auditAction", () => {
      expect(resolver.name).toBe("auditAction");
    });

    test("operation is mutation", () => {
      expect(resolver.operation).toBe("mutation");
    });

    test("admin can audit", () => {
      const result = resolver.body({
        input: { action: "delete", targetId: "item-123" },
        user: { id: "user-1", type: "user", attributes: { role: "admin" } },
        env: {},
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("Audit logged");
      expect(result.auditEntry).toBeDefined();
      expect(result.auditEntry.userId).toBe("user-1");
      expect(result.auditEntry.action).toBe("delete");
      expect(result.auditEntry.targetId).toBe("item-123");
    });

    test("auditor can audit", () => {
      const result = resolver.body({
        input: { action: "review", targetId: "item-456", reason: "Compliance check" },
        user: { id: "user-2", type: "user", attributes: { role: "auditor" } },
        env: {},
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("Audit logged");
      expect(result.auditEntry).toBeDefined();
      expect(result.auditEntry.reason).toBe("Compliance check");
    });

    test("non-admin role is denied", () => {
      const result = resolver.body({
        input: { action: "delete", targetId: "item-123" },
        user: { id: "user-3", type: "user", attributes: { role: "viewer" } },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Access denied");
      expect(result.message).toContain("viewer");
      expect(result.auditEntry).toBeUndefined();
    });

    test("no role shows unknown in message", () => {
      const result = resolver.body({
        input: { action: "delete", targetId: "item-123" },
        user: { id: "user-4", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Access denied");
      expect(result.message).toContain("unknown");
    });

    test("reason defaults to No reason provided", () => {
      const result = resolver.body({
        input: { action: "update", targetId: "item-789" },
        user: { id: "user-5", type: "user", attributes: { role: "admin" } },
        env: {},
      });
      expect(result.success).toBe(true);
      expect(result.auditEntry.reason).toBe("No reason provided");
    });
  });
});
