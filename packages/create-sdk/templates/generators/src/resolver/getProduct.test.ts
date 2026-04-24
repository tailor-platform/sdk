import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import resolver from "./getProduct";

describe("getProduct resolver", () => {
  const mockQueryObject = vi.fn();
  beforeAll(() => {
    vi.stubGlobal("tailordb", {
      Client: vi.fn(
        class {
          connect = vi.fn();
          end = vi.fn();
          queryObject = mockQueryObject;
        },
      ),
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    mockQueryObject.mockReset();
  });

  test("returns product with category", async () => {
    // Select product
    mockQueryObject.mockResolvedValueOnce({
      rows: [
        {
          id: "product-1",
          name: "Widget",
          price: 9.99,
          status: "ACTIVE",
          categoryId: "cat-1",
          description: null,
          createdAt: new Date(),
          updatedAt: null,
        },
      ],
    });
    // Select category
    mockQueryObject.mockResolvedValueOnce({
      rows: [{ name: "Gadgets" }],
    });

    const result = await resolver.body({
      input: { productId: "product-1" },
      user: unauthenticatedTailorUser,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({
      name: "Widget",
      price: 9.99,
      status: "ACTIVE",
      categoryName: "Gadgets",
    });
    expect(mockQueryObject).toHaveBeenCalledTimes(2);
  });

  test("returns product without category", async () => {
    // Select product (no categoryId)
    mockQueryObject.mockResolvedValueOnce({
      rows: [
        {
          id: "product-2",
          name: "Standalone Item",
          price: 19.99,
          status: "DRAFT",
          categoryId: null,
          description: null,
          createdAt: new Date(),
          updatedAt: null,
        },
      ],
    });

    const result = await resolver.body({
      input: { productId: "product-2" },
      user: unauthenticatedTailorUser,
      invoker: null,
      env: {},
    });

    expect(result).toEqual({
      name: "Standalone Item",
      price: 19.99,
      status: "DRAFT",
      categoryName: null,
    });
    expect(mockQueryObject).toHaveBeenCalledTimes(1);
  });
});
