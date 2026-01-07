import { describe, test } from "vitest";
import type { PermissionCondition } from "./permission";

describe("tailordb permission types", () => {
  test("PermissionCondition enforces operator-specific RHS types", () => {
    const _eqOk1 = [{ user: "id" }, "=", "u_123"] satisfies PermissionCondition;
    const _eqOk2 = [{ user: "id" }, "=", true] satisfies PermissionCondition;
    // @ts-expect-error array type is not allowed with "="
    const _eqEr1 = [{ user: "id" }, "=", ["u_123"]] satisfies PermissionCondition;

    const _inOk1 = [{ record: "id" }, "in", ["r1", "r2"]] satisfies PermissionCondition;
    const _inOk2 = [{ record: "id" }, "in", [true, true]] satisfies PermissionCondition;
    // @ts-expect-error scalar type is not allowed with "in"
    const _inEr1 = [{ record: "id" }, "in", "r1"] satisfies PermissionCondition;
  });

  test("PermissionCondition RHS type enforcement", () => {
    const _eqOk1 = ["string", "=", "admin"] satisfies PermissionCondition;
    // @ts-expect-error RHS must be string
    const _eqErr1 = ["string", "=", ["admin"]] satisfies PermissionCondition;
    // @ts-expect-error RHS must be string
    const _eqErr2 = ["string", "=", true] satisfies PermissionCondition;

    const _inOk1 = ["string", "in", ["admin", "user"]] satisfies PermissionCondition;
    // @ts-expect-error RHS must be an array
    const _inErr1 = ["string", "in", "admin"] satisfies PermissionCondition;
    // @ts-expect-error RHS must be string[]
    const _inErr2 = ["string", "in", [true, false]] satisfies PermissionCondition;

    const _eqOk3 = [true, "=", true] satisfies PermissionCondition;
    // @ts-expect-error RHS must be boolean
    const _eqErr3 = [true, "=", [true]] satisfies PermissionCondition;
    // @ts-expect-error RHS must be boolean
    const _eqErr4 = [true, "=", "true"] satisfies PermissionCondition;

    const _inOk3 = [true, "in", [true, false]] satisfies PermissionCondition;
    // @ts-expect-error RHS must be an array
    const _inErr3 = [true, "in", true] satisfies PermissionCondition;
    // @ts-expect-error RHS must be boolean[]
    const _inErr4 = [true, "in", ["admin", "true"]] satisfies PermissionCondition;
  });

  test("PermissionCondition with gql level", () => {
    const _eqOk = ["user.isAdmin", "=", true] satisfies PermissionCondition<"gql">;
    const _inOk = ["user.isAdmin", "in", [true]] satisfies PermissionCondition<"gql">;

    // @ts-expect-error record-level: string cannot be compared to boolean
    const _eqErr = ["user.isAdmin", "=", true] satisfies PermissionCondition;
    // @ts-expect-error record-level: string cannot be compared to boolean[]
    const _inErr = ["user.isAdmin", "in", [true]] satisfies PermissionCondition;
  });

  test("LHS must be non-array type", () => {
    // @ts-expect-error LHS must be non-array type
    const _err = [["user", "id"], "in", ["u_123"]] satisfies PermissionCondition;
  });
});
