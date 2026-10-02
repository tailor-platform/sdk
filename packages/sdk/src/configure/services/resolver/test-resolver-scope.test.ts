import { describe, expect, test } from "vitest";
import { isInResolverTestScope, withResolverTestScope } from "./test-resolver-scope";

describe("resolver test scope", () => {
  test("is inactive outside a resolver body", () => {
    expect(isInResolverTestScope()).toBe(false);
  });

  test("stays active across awaits inside a resolver body", async () => {
    const seen = await withResolverTestScope(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return isInResolverTestScope();
    });

    expect(seen).toBe(true);
    expect(isInResolverTestScope()).toBe(false);
  });

  test("does not leak into work that runs concurrently outside the scope", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = withResolverTestScope(async () => {
      await gate;
      return isInResolverTestScope();
    });
    const outside = (async () => {
      await Promise.resolve();
      const seen = isInResolverTestScope();
      release();
      return seen;
    })();

    expect(await Promise.all([inside, outside])).toEqual([true, false]);
  });
});
