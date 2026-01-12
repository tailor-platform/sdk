import { describe, test } from "vitest";
import type { PermissionCondition } from "./permission";

describe("tailordb permission types", () => {
  type User = {
    id: string;
    roles: string[];
    isAdmin: boolean;
  };

  test("PermissionCondition enforces operator-specific RHS types", () => {
    const _eqOk1 = ["string", "=", "u_123"] satisfies PermissionCondition;
    // @ts-expect-error RHS must be string
    const _eqEr1 = ["string", "=", ["u_123"]] satisfies PermissionCondition;
    const _eqOk2 = [true, "=", false] satisfies PermissionCondition;
    // @ts-expect-error RHS must be boolean
    const _eqEr2 = [true, "=", [false]] satisfies PermissionCondition;

    const _inOk1 = ["string", "in", ["r1", "r2"]] satisfies PermissionCondition;
    // @ts-expect-error RHS must be string[]
    const _inEr1 = ["string", "in", "r1"] satisfies PermissionCondition;
    const _inOk2 = [true, "in", [true, false]] satisfies PermissionCondition;
    // @ts-expect-error RHS must be boolean[]
    const _inEr2 = [true, "in", true] satisfies PermissionCondition;
  });

  test("PermissionCondition with User type and string field", () => {
    const _eqOk1 = [{ user: "id" }, "=", "u_123"] satisfies PermissionCondition<"record", User>;
    // @ts-expect-error RHS must be string
    const _eqEr1 = [{ user: "id" }, "=", true] satisfies PermissionCondition<"record", User>;

    const _inOk1 = [{ user: "id" }, "in", ["u_123"]] satisfies PermissionCondition<"record", User>;
    // @ts-expect-error RHS must be string[]
    const _inEr1 = [{ user: "id" }, "in", [true]] satisfies PermissionCondition<"record", User>;

    const _inOk2 = ["MANAGER", "in", { user: "roles" }] satisfies PermissionCondition<
      "record",
      User
    >;
    // @ts-expect-error RHS must be string[]
    const _inEr2 = ["MANAGER", "in", { user: "id" }] satisfies PermissionCondition<"record", User>;
  });

  test("PermissionCondition with User type and boolean field", () => {
    const _eqOk1 = [{ user: "isAdmin" }, "=", true] satisfies PermissionCondition<"record", User>;
    // @ts-expect-error RHS must be boolean
    const _eqErr1 = [{ user: "isAdmin" }, "=", "string"] satisfies PermissionCondition<
      "record",
      User
    >;

    const _inOk1 = [{ user: "isAdmin" }, "in", [true]] satisfies PermissionCondition<
      "record",
      User
    >;
    // @ts-expect-error RHS must be boolean[]
    const _inErr1 = [{ user: "isAdmin" }, "in", ["string"]] satisfies PermissionCondition<
      "record",
      User
    >;

    const _eqOk2 = [false, "=", { user: "isAdmin" }] satisfies PermissionCondition<"record", User>;
    // @ts-expect-error RHS must be boolean
    const _eqErr2 = ["string", "=", { user: "isAdmin" }] satisfies PermissionCondition<
      "record",
      User
    >;
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
