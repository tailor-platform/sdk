import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { describe, expect, test } from "vitest";
import resolver from "./showEnv";

describe("showEnv resolver", () => {
  test("returns environment variables", async () => {
    const result = await resolver.body({
      input: undefined as never,
      user: unauthenticatedTailorUser,
      env: { appName: "Test App", version: 2 },
    });
    expect(result).toEqual({ appName: "Test App", version: 2 });
  });
});
