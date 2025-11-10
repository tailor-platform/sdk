import { unauthenticatedTailorUser } from "@tailor-platform/tailor-sdk";
import { describe, expect, test } from "vitest";
import resolver from "../src/resolver/add";

describe("add resolver", () => {
  test("basic functionality", async () => {
    const result = await resolver.body({
      input: { left: 1, right: 2 },
      user: unauthenticatedTailorUser,
    });
    expect(result).toBe(3);
  });
});
