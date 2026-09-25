// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test, expectTypeOf } from "vitest";
import type { IdPPermission } from "./permission";
import type { IdPOwnConfig } from "./types";

describe("IdPOwnConfig", () => {
  test("permission field matches the configure-layer IdPPermission type that defineIdp accepts", () => {
    expectTypeOf<IdPOwnConfig["permission"]>().toEqualTypeOf<IdPPermission | undefined>();
  });
});
