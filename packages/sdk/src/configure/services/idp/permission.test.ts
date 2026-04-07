import { describe, expectTypeOf, it } from "vitest";
import type { IdPPermission, IdPPermissionCondition } from "./permission";

describe("IdPPermissionCondition type checks", () => {
  it("accepts user operand with equality operator", () => {
    const _cond: IdPPermissionCondition = [{ user: "id" }, "=", "some-value"];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition>();
  });

  it("accepts idpUser operand for non-update actions", () => {
    const _cond: IdPPermissionCondition<object, false> = [
      { idpUser: "email" },
      "=",
      "test@example.com",
    ];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition<object, false>>();
  });

  it("accepts oldIdpUser/newIdpUser operands for update actions", () => {
    const _cond1: IdPPermissionCondition<object, true> = [
      { oldIdpUser: "email" },
      "!=",
      { newIdpUser: "email" },
    ];
    expectTypeOf(_cond1).toExtend<IdPPermissionCondition<object, true>>();
  });

  it("accepts in operator with array values", () => {
    const _cond: IdPPermissionCondition = [{ user: "id" }, "in", ["a", "b"]];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition>();
  });

  it("accepts not in operator", () => {
    const _cond: IdPPermissionCondition = [{ user: "id" }, "not in", ["a"]];
    expectTypeOf(_cond).toExtend<IdPPermissionCondition>();
  });

  it("rejects hasAny operator", () => {
    // @ts-expect-error - hasAny is not supported for IdP permissions
    const _cond: IdPPermissionCondition = [{ user: "id" }, "hasAny", ["a"]];
  });

  it("rejects not hasAny operator", () => {
    // @ts-expect-error - not hasAny is not supported for IdP permissions
    const _cond: IdPPermissionCondition = [{ user: "id" }, "not hasAny", ["a"]];
  });
});

describe("IdPPermission type checks", () => {
  it("accepts valid full permission", () => {
    const _perm: IdPPermission = {
      create: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
      read: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
      update: [{ conditions: [[{ newIdpUser: "email" }, "=", "test"]], permit: true }],
      delete: [{ conditions: [[{ user: "id" }, "=", "admin"]], permit: true }],
      sendPasswordResetEmail: [{ conditions: [], permit: true }],
    };
    expectTypeOf(_perm).toExtend<IdPPermission>();
  });

  it("accepts empty permission arrays (deny-all)", () => {
    const _perm: IdPPermission = {
      create: [],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
    };
    expectTypeOf(_perm).toExtend<IdPPermission>();
  });
});
