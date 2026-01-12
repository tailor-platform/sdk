import { describe, test } from "vitest";
import type { PermissionCondition } from "./permission";

describe("tailordb permission types", () => {
  type User = {
    id: string;
    roles: string[];
    isAdmin: boolean;
  };

  describe("record level", () => {
    test("literal values - string and boolean", () => {
      // String literals
      const _strOk = ["string", "=", "string"] satisfies PermissionCondition;
      const _strArrOk = ["string", "in", ["string"]] satisfies PermissionCondition;
      // @ts-expect-error Type mismatch: string vs boolean
      const _strErr = ["string", "=", true] satisfies PermissionCondition;
      // @ts-expect-error Type mismatch: string vs boolean[]
      const _strArrErr = ["string", "in", [true]] satisfies PermissionCondition;

      // Boolean literals
      const _boolOk = [true, "=", false] satisfies PermissionCondition;
      const _boolArrOk = [true, "in", [true]] satisfies PermissionCondition;
      // @ts-expect-error Type mismatch: boolean vs string
      const _boolErr = [true, "=", "string"] satisfies PermissionCondition;
      // @ts-expect-error Type mismatch: boolean vs string[]
      const _boolArrErr = [true, "in", ["string"]] satisfies PermissionCondition;
    });

    test("user operand - string field", () => {
      const _ok = [{ user: "id" }, "=", "u_123"] satisfies PermissionCondition<"record", User>;
      const _okReverse = ["u_123", "=", { user: "id" }] satisfies PermissionCondition<
        "record",
        User
      >;
      // @ts-expect-error Type mismatch: string field vs boolean value
      const _err = [{ user: "id" }, "=", true] satisfies PermissionCondition<"record", User>;
    });

    test("user operand - boolean field", () => {
      const _ok = [{ user: "isAdmin" }, "=", true] satisfies PermissionCondition<"record", User>;
      const _okReverse = [false, "=", { user: "isAdmin" }] satisfies PermissionCondition<
        "record",
        User
      >;
      // @ts-expect-error Type mismatch: boolean field vs string value
      const _err = [{ user: "isAdmin" }, "=", "string"] satisfies PermissionCondition<
        "record",
        User
      >;
    });

    test("user operand - array field", () => {
      const _ok = ["MANAGER", "in", { user: "roles" }] satisfies PermissionCondition<
        "record",
        User
      >;
      // @ts-expect-error Type mismatch: string[] field vs string field
      const _err = ["MANAGER", "in", { user: "id" }] satisfies PermissionCondition<"record", User>;
    });
  });

  describe("gql level", () => {
    test("string references - valid string fields", () => {
      const _eqOk = ["user.id", "=", "u_123"] satisfies PermissionCondition<"gql", User>;
      const _inOk = ["user.id", "in", ["u_123"]] satisfies PermissionCondition<"gql", User>;
      // @ts-expect-error Type mismatch: string field vs boolean value
      const _eqErr = ["user.id", "=", true] satisfies PermissionCondition<"gql", User>;
      // @ts-expect-error Type mismatch: string field vs boolean[]
      const _inErr = ["user.id", "in", [true]] satisfies PermissionCondition<"gql", User>;
    });

    test("string references - valid boolean fields", () => {
      const _eqOk = ["user.isAdmin", "=", true] satisfies PermissionCondition<"gql", User>;
      const _inOk = ["user.isAdmin", "in", [true]] satisfies PermissionCondition<"gql", User>;
      // @ts-expect-error Type mismatch: boolean field vs string value
      const _eqErr = ["user.isAdmin", "=", "string"] satisfies PermissionCondition<"gql", User>;
      // @ts-expect-error Type mismatch: boolean field vs string[]
      const _inErr = ["user.isAdmin", "in", ["string"]] satisfies PermissionCondition<"gql", User>;
    });

    test("string references - invalid field names", () => {
      // @ts-expect-error Field "uuid" does not exist in User type
      const _err1 = ["user.uuid", "=", "u_123"] satisfies PermissionCondition<"gql", User>;
      // @ts-expect-error Field "active" does not exist in User type
      const _err2 = ["user.active", "=", true] satisfies PermissionCondition<"gql", User>;
    });
  });

  describe("common pitfalls", () => {
    test("array field must be on RHS, not LHS when using 'in' operator", () => {
      const _ok = ["MANAGER", "in", { user: "roles" }] satisfies PermissionCondition<
        "record",
        User
      >;

      // Common mistake: array field on LHS (this was an actual bug)
      // @ts-expect-error Array field must be on RHS, not LHS
      const _err = [{ user: "roles" }, "in", "MANAGER"] satisfies PermissionCondition<
        "record",
        User
      >;
    });
  });
});
