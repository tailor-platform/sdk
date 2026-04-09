import { describe, expect, it } from "vitest";
import { normalizeIdPActionPermission, normalizeIdPPermission } from "./permission";

describe("normalizeIdPActionPermission", () => {
  describe("object format", () => {
    it("normalizes object with conditions array and permit true", () => {
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

    it("normalizes object with permit false to deny", () => {
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

    it("defaults permit to deny when omitted", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
      });
      expect(result.permit).toBe("deny");
    });

    it("preserves description", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
        permit: true,
        description: "Admin only",
      });
      expect(result.description).toBe("Admin only");
    });

    it("normalizes single condition (not wrapped in array)", () => {
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

    it("normalizes empty conditions", () => {
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
    it("maps = to eq", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ idpUser: "name" }, "=", "test@example.com"]],
        permit: true,
      });
      expect(result.conditions[0][1]).toBe("eq");
    });

    it("maps != to ne", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ idpUser: "name" }, "!=", "test@example.com"]],
        permit: true,
      });
      expect(result.conditions[0][1]).toBe("ne");
    });

    it("maps in to in", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "in", ["ADMIN", "MANAGER"]]],
        permit: true,
      });
      expect(result.conditions[0][1]).toBe("in");
    });

    it("maps not in to nin", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "not in", ["GUEST"]]],
        permit: true,
      });
      expect(result.conditions[0][1]).toBe("nin");
    });
  });

  describe("operand mapping", () => {
    it("maps { user: 'id' } to { user: '_id' }", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "id" }, "=", "some-id"]],
        permit: true,
      });
      expect(result.conditions[0][0]).toEqual({ user: "_id" });
    });

    it("passes through { user: 'role' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "role" }, "=", "ADMIN"]],
        permit: true,
      });
      expect(result.conditions[0][0]).toEqual({ user: "role" });
    });

    it("passes through { idpUser: 'name' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ idpUser: "name" }, "=", "test"]],
        permit: true,
      });
      expect(result.conditions[0][0]).toEqual({ idpUser: "name" });
    });

    it("passes through { oldIdpUser: 'name' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ oldIdpUser: "name" }, "=", "test"]],
        permit: true,
      });
      expect(result.conditions[0][0]).toEqual({ oldIdpUser: "name" });
    });

    it("passes through { newIdpUser: 'name' } as-is", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ newIdpUser: "name" }, "=", "test"]],
        permit: true,
      });
      expect(result.conditions[0][0]).toEqual({ newIdpUser: "name" });
    });

    it("passes through string literals", () => {
      const result = normalizeIdPActionPermission({
        conditions: [["value", "=", "other"]],
        permit: true,
      });
      expect(result.conditions[0][0]).toBe("value");
      expect(result.conditions[0][2]).toBe("other");
    });

    it("passes through boolean literals", () => {
      const result = normalizeIdPActionPermission({
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
      });
      expect(result.conditions[0][2]).toBe(true);
    });
  });

  describe("array shorthand format", () => {
    it("normalizes single condition array", () => {
      const result = normalizeIdPActionPermission([{ user: "role" }, "=", "ADMIN"]);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "allow",
      });
    });

    it("normalizes single condition array with explicit permit", () => {
      const result = normalizeIdPActionPermission([{ user: "role" }, "=", "ADMIN", false]);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "ADMIN"]],
        permit: "deny",
      });
    });
  });
});

describe("normalizeIdPPermission", () => {
  it("normalizes all 5 action types", () => {
    const raw = {
      create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
      update: [
        { conditions: [[{ newIdpUser: "name" }, "!=", { oldIdpUser: "name" }]], permit: true },
      ],
      delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      sendPasswordResetEmail: [{ conditions: [], permit: true }],
    };

    const result = normalizeIdPPermission(raw as Parameters<typeof normalizeIdPPermission>[0]);

    expect(result.create).toHaveLength(1);
    expect(result.read).toHaveLength(1);
    expect(result.update).toHaveLength(1);
    expect(result.delete).toHaveLength(1);
    expect(result.sendPasswordResetEmail).toHaveLength(1);

    expect(result.create[0].permit).toBe("allow");
    expect(result.update[0].conditions[0][1]).toBe("ne");
  });

  it("handles empty permission arrays", () => {
    const raw = {
      create: [],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
    };

    const result = normalizeIdPPermission(raw as Parameters<typeof normalizeIdPPermission>[0]);

    expect(result.create).toHaveLength(0);
    expect(result.read).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.delete).toHaveLength(0);
    expect(result.sendPasswordResetEmail).toHaveLength(0);
  });
});
