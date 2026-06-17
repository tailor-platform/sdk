import { describe, expect, test } from "vitest";
import resolver from "./showEnv";

describe("showEnv resolver", () => {
  test("returns environment variables", async () => {
    const result = await resolver.body({
      input: undefined as never,
      caller: null,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({ appName: "Resolver Template", version: 1 });
  });
});
