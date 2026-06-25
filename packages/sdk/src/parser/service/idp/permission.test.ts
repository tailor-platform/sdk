import { describe, expect, test } from "vitest";
import {
  findOmittedPermitRules,
  normalizeIdPActionPermission,
  normalizeIdPPermission,
} from "./permission";

describe("normalizeIdPActionPermission", () => {
  describe("object format", () => {
    test("normalizes object with conditions array and permit true", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
        permit: true,
      });
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "allow",
        description: undefined,
      });
    });

    test("normalizes object with permit false to deny", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
        permit: false,
      });
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "deny",
        description: undefined,
      });
    });

    test("defaults permit to deny when omitted", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
      });
      expect(result.permit).toBe("deny");
    });

    test("preserves description", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
        permit: true,
        description: "Admin only",
      });
      expect(result.description).toBe("Admin only");
    });

    test("normalizes single condition (not wrapped in array)", () => {
      const result = normalizeIdPActionPermission({
        conditions: [{ user: "role" }, "=", "ADMIN"],
        permit: true,
      });
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "allow",
        description: undefined,
      });
    });

    test("normalizes empty conditions", () => {
      const result = normalizeIdPActionPermission({
        conditions: [],
        permit: true,
      });
      expect(result).toEqual({
        conditions: [],
        permit: "allow",
        description: undefined,
      });
    });
  });

  describe("operator mapping", () => {
    test("maps = to eq", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ idpUser: "name" }, "=", "test@example.com"]],
        permit: true,
      });
      expect(result.conditions[0]![1]).toBe("eq");
    });

    test("maps != to ne", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ idpUser: "name" }, "!=", "test@example.com"]],
        permit: true,
      });
      expect(result.conditions[0]![1]).toBe("ne");
    });

    test("maps in to in", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "in", ["ADMIN", "MANAGER"]]],
        permit: true,
      });
      expect(result.conditions[0]![1]).toBe("in");
    });

    test("maps not in to nin", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "not in", ["GUEST"]]],
        permit: true,
      });
      expect(result.conditions[0]![1]).toBe("nin");
    });
  });

  describe("operand mapping", () => {
    test("maps { user: 'id' } to { user: '_id' }", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "id" }, "=", "some-id"]],
        permit: true,
      });
      expect(result.conditions[0]![0]).toEqual({ user: "_id" });
    });

    test("passes through { user: 'role' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
        permit: true,
      });
      expect(result.conditions[0]![0]).toEqual({ user: "role" });
    });

    test("passes through { idpUser: 'name' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ idpUser: "name" }, "=", "test"]],
        permit: true,
      });
      expect(result.conditions[0]![0]).toEqual({ idpUser: "name" });
    });

    test("passes through { oldIdpUser: 'name' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ oldIdpUser: "name" }, "=", "test"]],
        permit: true,
      });
      expect(result.conditions[0]![0]).toEqual({ oldIdpUser: "name" });
    });

    test("passes through { newIdpUser: 'name' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ newIdpUser: "name" }, "=", "test"]],
        permit: true,
      });
      expect(result.conditions[0]![0]).toEqual({ newIdpUser: "name" });
    });

    test("passes through string literals", () => {
      const result = normalizeIdPActionPermission({
        conditions: [["value", "=", "other"]],
        permit: true,
      });
      expect(result.conditions[0]![0]).toBe("value");
      expect(result.conditions[0]![2]).toBe("other");
    });

    test("passes through boolean literals", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
      });
      expect(result.conditions[0]![2]).toBe(true);
    });
  });

  describe("array shorthand format", () => {
    test("normalizes single condition array", () => {
      const result = normalizeIdPActionPermission([{ user: "role" }, "=", "ADMIN"]);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "allow",
      });
    });

    test("normalizes single condition array with explicit permit", () => {
      const result = normalizeIdPActionPermission([{ user: "role" }, "=", "ADMIN", false]);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "deny",
      });
    });
  });
});

describe("normalizeIdPPermission", () => {
  test("normalizes all 6 action types", () => {
    const raw: Parameters<typeof normalizeIdPPermission>[0] = {
      create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
      update: [
        { conditions: [[{ newIdpUser: "name" }, "!=", { oldIdpUser: "name" }]], permit: true },
      ],
      delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      sendPasswordResetEmail: [{ conditions: [], permit: true }],
      unenrollMfa: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    };

    const result = normalizeIdPPermission(raw);

    expect(result.create).toHaveLength(1);
    expect(result.read).toHaveLength(1);
    expect(result.update).toHaveLength(1);
    expect(result.delete).toHaveLength(1);
    expect(result.sendPasswordResetEmail).toHaveLength(1);
    expect(result.unenrollMfa).toHaveLength(1);

    expect(result.create[0]!.permit).toBe("allow");
    expect(result.update[0]!.conditions[0]![1]).toBe("ne");
    expect(result.unenrollMfa[0]!.permit).toBe("allow");
  });

  test("handles empty permission arrays", () => {
    const raw: Parameters<typeof normalizeIdPPermission>[0] = {
      create: [],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [],
    };

    const result = normalizeIdPPermission(raw);

    expect(result.create).toHaveLength(0);
    expect(result.read).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.delete).toHaveLength(0);
    expect(result.sendPasswordResetEmail).toHaveLength(0);
    expect(result.unenrollMfa).toHaveLength(0);
  });
});

describe("findOmittedPermitRules", () => {
  type RawIdPPermission = NonNullable<Parameters<typeof findOmittedPermitRules>[0]>;

  test("flags object-form rules that omit permit", () => {
    const result = findOmittedPermitRules({
      create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]] }],
      read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [],
    } as RawIdPPermission);
    expect(result).toEqual(["create[0]"]);
  });

  test("ignores array-shorthand rules (they default to allow)", () => {
    const result = findOmittedPermitRules({
      create: [[{ user: "role" }, "=", "ADMIN"]],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [],
    } as RawIdPPermission);
    expect(result).toEqual([]);
  });

  test("flags single-array object form", () => {
    const result = findOmittedPermitRules({
      create: [{ conditions: [{ user: "role" }, "=", "ADMIN"] }],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [],
    } as RawIdPPermission);
    expect(result).toEqual(["create[0]"]);
  });

  test("flags object-form rules in unenrollMfa that omit permit", () => {
    const result = findOmittedPermitRules({
      create: [],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]] }],
    } as RawIdPPermission);
    expect(result).toEqual(["unenrollMfa[0]"]);
  });

  test("returns empty for undefined permission", () => {
    expect(findOmittedPermitRules(undefined)).toEqual([]);
  });
});
