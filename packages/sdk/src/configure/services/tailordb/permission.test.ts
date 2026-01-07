import { describe, test } from "vitest";
import type { PermissionCondition } from "./permission";

describe("tailordb permission types", () => {
  test("PermissionCondition enforces operator-specific RHS types", () => {
    const _eqOk = [{ user: "id" }, "=", "u_123"] satisfies PermissionCondition;
    const _inOk = [{ record: "id" }, "in", ["r1", "r2"]] satisfies PermissionCondition;

    // @ts-expect-error array type is not allowed with "="
    const _eqEr = [{ user: "id" }, "=", ["u_123"]] satisfies PermissionCondition;
    // @ts-expect-error scalar type is not allowed with "in"
    const _inEr = [{ record: "id" }, "in", "r1"] satisfies PermissionCondition;
  });
});
