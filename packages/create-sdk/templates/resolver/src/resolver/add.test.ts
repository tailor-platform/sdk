import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { describe, expect, test } from "vitest";
import resolver from "./add";

describe("add resolver", () => {
  test("adds two positive numbers", async () => {
    const result = await resolver.body({
      input: { left: 1, right: 2 },
      user: unauthenticatedTailorUser,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toBe(3);
  });

  test("handles negative numbers", async () => {
    const result = await resolver.body({
      input: { left: -5, right: 3 },
      user: unauthenticatedTailorUser,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toBe(-2);
  });
});
