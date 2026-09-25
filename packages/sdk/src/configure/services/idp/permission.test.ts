// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test, expectTypeOf } from "vitest";
import type { IdPPermission, IdPPermissionCondition } from "./permission";

describe("IdPPermissionCondition type checks", () => {
  test("accepts user operand with equality operator", () => {
    const _cond: IdPPermissionCondition = [{ user: "id" }, "=", "some-value"];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition>();
  });

  test("accepts idpUser operand for non-update actions", () => {
    const _cond: IdPPermissionCondition<object, false> = [
      { idpUser: "name" },
      "=",
      "test@example.com",
    ];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition<object, false>>();
  });

  test("accepts oldIdpUser/newIdpUser operands for update actions", () => {
    const _cond1: IdPPermissionCondition<object, true> = [
      { oldIdpUser: "name" },
      "!=",
      { newIdpUser: "name" },
    ];
    expectTypeOf(_cond1).toExtend<IdPPermissionCondition<object, true>>();
  });

  test("accepts in operator with array values", () => {
    const _cond: IdPPermissionCondition = [{ user: "id" }, "in", ["a", "b"]];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition>();
  });

  test("accepts not in operator", () => {
    const _cond: IdPPermissionCondition = [{ user: "id" }, "not in", ["a"]];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition>();
  });

  test("rejects hasAny operator", () => {
    // @ts-expect-error - hasAny is not supported for IdP permissions
    const _cond: IdPPermissionCondition = [{ user: "id" }, "hasAny", ["a"]];
  });

  test("rejects not hasAny operator", () => {
    // @ts-expect-error - not hasAny is not supported for IdP permissions
    const _cond: IdPPermissionCondition = [{ user: "id" }, "not hasAny", ["a"]];
  });
});

describe("IdPPermissionCondition with optional attribute fields", () => {
  type OptionalAttrs = {
    role?: string;
    permissions?: string[];
    active?: boolean;
    flags?: boolean[];
  };

  test("accepts user operands referencing optional attribute fields", () => {
    const _str: IdPPermissionCondition<OptionalAttrs, false> = [{ user: "role" }, "=", "ADMIN"];
    const _bool: IdPPermissionCondition<OptionalAttrs, false> = [{ user: "active" }, "=", true];
    const _strArr: IdPPermissionCondition<OptionalAttrs, false> = [
      "a",
      "in",
      { user: "permissions" },
    ];
    expectTypeOf(_str).toExtend<IdPPermissionCondition<OptionalAttrs, false>>();
    expectTypeOf(_bool).toExtend<IdPPermissionCondition<OptionalAttrs, false>>();
    expectTypeOf(_strArr).toExtend<IdPPermissionCondition<OptionalAttrs, false>>();
  });

  test("does not leak undefined into user operand keys", () => {
    type UserOperandKeys = Extract<
      IdPPermissionCondition<OptionalAttrs, false>[0],
      { user: unknown }
    >["user"];
    expectTypeOf<undefined>().not.toExtend<UserOperandKeys>();
  });
});

describe("IdPPermission type checks", () => {
  test("accepts valid full permission", () => {
    const _perm: IdPPermission = {
      create: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
      read: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
      update: [{ conditions: [[{ newIdpUser: "name" }, "=", "test"]], permit: true }],
      delete: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
      sendPasswordResetEmail: [{ conditions: [], permit: true }],
      unenrollMfa: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
    };
    expectTypeOf(_perm).toExtend<IdPPermission>();
  });

  test("accepts empty permission arrays (deny-all)", () => {
    const _perm: IdPPermission = {
      create: [],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [],
    };
    expectTypeOf(_perm).toExtend<IdPPermission>();
  });
});
