import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { mockTailordb } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import resolver from "./getProduct";

describe("getProduct resolver", () => {
  test("returns product with category", async () => {
    using db = mockTailordb();
    // Select product
    db.enqueueResult({
      id: "product-1",
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
      input: { productId: "product-1" },
      user: unauthenticatedTailorUser,
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
      id: "product-2",
      name: "Standalone Item",
      price: 19.99,
      status: "DRAFT",
      categoryId: null,
      description: null,
      createdAt: new Date(),
      updatedAt: null,
    });

    const result = await resolver.body({
      input: { productId: "product-2" },
      user: unauthenticatedTailorUser,
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
