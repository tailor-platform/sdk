import { assertType, describe, test } from "vitest";
import type { EnvEntry } from "./types";

describe("EnvEntry", () => {
  test("accepts a plain value of every deployable type", () => {
    assertType<EnvEntry>("token");
    assertType<EnvEntry>(123456789012);
    assertType<EnvEntry>(true);
  });

  test("accepts an allowance on the values detection can flag", () => {
    assertType<EnvEntry>({ value: "xoxb-token", allowSecretReason: "demo workspace" });
    assertType<EnvEntry>({ value: 123456789012, allowSecretReason: "public account id" });
  });

  test("rejects an allowance on a boolean, which detection never flags", () => {
    // @ts-expect-error a boolean matches no credential format, so it needs no allowance
    assertType<EnvEntry>({ value: true, allowSecretReason: "not a credential" });
  });

  test("rejects an allowance without a reason", () => {
    // @ts-expect-error the reason is what makes the allowance reviewable
    assertType<EnvEntry>({ value: "xoxb-token" });
  });
});
