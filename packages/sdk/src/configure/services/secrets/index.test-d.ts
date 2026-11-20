import { assertType, describe, test } from "vitest";
import { defineSecretManager } from "./index";

describe("defineSecretManager secret values", () => {
  test("accepts a { create } value next to a string", () => {
    assertType(defineSecretManager({ vault: { key: { create: "generated" }, plain: "value" } }));
  });

  test("accepts a nullish { create } value only with ignoreNullishValues", () => {
    // @ts-expect-error -- a nullish value needs { ignoreNullishValues: true }
    assertType(defineSecretManager({ vault: { key: { create: undefined } } }));
    assertType(
      defineSecretManager({ vault: { key: { create: undefined } } }, { ignoreNullishValues: true }),
    );
  });
});
