import { mockTailordb } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import resolver from "./getProduct";

describe("getProduct resolver", () => {
  test("returns product with category", async () => {
    using db = mockTailordb();
    // Select product
    db.enqueueResult({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Widget",
      price: 9.99,
      status: "ACTIVE",
      categoryId: "cat-1",
      description: null,
      createdAt: new Date(),
      updatedAt: null,
    });
    // Select category
    db.enqueueResult({ name: "Gadgets" });

    const result = await resolver.body({
      input: { productId: "00000000-0000-4000-8000-000000000001" },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({
      name: "Widget",
      price: 9.99,
      status: "ACTIVE",
      categoryName: "Gadgets",
    });
    expect(db.executedQueries).toHaveLength(2);
  });

  test("returns product without category", async () => {
    using db = mockTailordb();
    // Select product (no categoryId)
    db.enqueueResult({
      id: "00000000-0000-4000-8000-000000000002",
      name: "Standalone Item",
      price: 19.99,
      status: "DRAFT",
      categoryId: null,
      description: null,
      createdAt: new Date(),
      updatedAt: null,
    });

    const result = await resolver.body({
      input: { productId: "00000000-0000-4000-8000-000000000002" },
      caller: null,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({
      name: "Standalone Item",
      price: 19.99,
      status: "DRAFT",
      categoryName: null,
    });
    expect(db.executedQueries).toHaveLength(1);
  });
});
