import { unauthenticatedTailorUser } from "@tailor-platform/sdk";
import { describe, expect, test } from "vitest";
import resolver from "./simple";

describe("add resolver", () => {
  test("basic functionality", async () => {
    const result = await resolver.body({
      input: { left: 1, right: 2 },
      user: unauthenticatedTailorUser,
      env: { foo: 1, bar: "hello", baz: true },
    });
    expect(result).toBe(3);
  });
});
