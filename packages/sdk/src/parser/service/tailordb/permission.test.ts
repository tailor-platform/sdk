import { describe, expect, it } from "vitest";
import {
  normalizeActionPermission,
  normalizeGqlPermission,
} from "./permission";

type Permission = Parameters<typeof normalizeActionPermission>[0];

describe("normalizeActionPermission", () => {
  describe("Object format", () => {
    it("should return object format as-is", () => {
      const permission = {
        conditions: [["user.id", "=", "123"]],
        permit: true,
      } as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "eq", "123"]],
        permit: "allow",
      });
    });

    it("should preserve description field", () => {
      const permission = {
        conditions: [["user.role", "in", ["admin", "manager"] as string[]]],
        description: "Admin and manager access",
        permit: false,
      } as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.role", "in", ["admin", "manager"]]],
        description: "Admin and manager access",
        permit: "deny",
      });
    });

    it("should handle single condition in object format", () => {
      const permission = {
        conditions: ["user.id", "=", "123"],
        permit: true,
      } as Permission;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([["user.id", "eq", "123"]]);
    });
  });

  describe("Single condition array format", () => {
    it("should normalize single condition without permit (defaults to true)", () => {
      const permission = ["user.id", "=", "123"] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "eq", "123"]],
        permit: "allow",
      });
    });

    it("should normalize single condition with permit=true", () => {
      const permission = ["user.id", "=", "123", true] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "eq", "123"]],
        permit: "allow",
      });
    });

    it("should normalize single condition with permit=false", () => {
      const permission = ["user.id", "!=", "123", false] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "ne", "123"]],
        permit: "deny",
      });
    });

    it("should handle array values in conditions", () => {
      const permission = [
        "user.role",
        "in",
        ["admin", "manager"] as string[],
      ] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.role", "in", ["admin", "manager"]]],
        permit: "allow",
      });
    });

    it("should handle user operand", () => {
      const permission = [
        { user: "role" },
        "=",
        "admin",
      ] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "admin"]],
        permit: "allow",
      });
    });

    it("should handle record operand", () => {
      const permission = [
        { record: "status" },
        "=",
        "active",
      ] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ record: "status" }, "eq", "active"]],
        permit: "allow",
      });
    });

    it("should handle oldRecord/newRecord operands for update", () => {
      const permission = [
        { oldRecord: "status" },
        "!=",
        { newRecord: "status" },
      ] as unknown as Permission;
      // Must specify Update=true for oldRecord/newRecord
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ oldRecord: "status" }, "ne", { newRecord: "status" }]],
        permit: "allow",
      });
    });
  });

  describe("Array of conditions format", () => {
    it("should normalize array of conditions without permit (all default to true)", () => {
      const permission = [
        ["user.role", "=", "admin"],
        ["user.active", "=", true],
      ] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [
          ["user.role", "eq", "admin"],
          ["user.active", "eq", true],
        ],
        permit: "allow",
      });
    });

    it("should normalize array of conditions with mixed permit values", () => {
      const permission = [
        ["user.role", "=", "admin"],
        ["user.active", "=", true],
        ["user.department", "in", ["sales", "marketing"] as string[]],
        true,
      ] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [
          ["user.role", "eq", "admin"],
          ["user.active", "eq", true],
          ["user.department", "in", ["sales", "marketing"]],
        ],
        permit: "allow",
      });
    });

    it("should handle empty array of conditions", () => {
      const permission = [] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [],
        permit: "allow",
      });
    });

    it("should handle complex nested conditions", () => {
      const permission = [
        [{ user: "id" }, "=", "123"],
        [{ record: "ownerId" }, "=", { user: "id" }],
        ["active", "=", true],
        false,
      ] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [
          [{ user: "_id" }, "eq", "123"],
          [{ record: "ownerId" }, "eq", { user: "_id" }],
          ["active", "eq", true],
        ],
        permit: "deny",
      });
    });
  });

  describe("Operator variations", () => {
    it("should handle '=' operator", () => {
      const permission = ["user.id", "=", "123"] as const;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([["user.id", "eq", "123"]]);
    });

    it("should handle '!=' operator", () => {
      const permission = ["user.status", "!=", "blocked"] as const;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([["user.status", "ne", "blocked"]]);
    });

    it("should handle 'in' operator", () => {
      const permission = [
        "user.role",
        "in",
        ["admin", "moderator"] as string[],
      ] as const;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([
        ["user.role", "in", ["admin", "moderator"]],
      ]);
    });

    it("should handle 'not in' operator", () => {
      const permission = [
        "user.status",
        "not in",
        ["suspended", "banned"] as string[],
      ] as const;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([
        ["user.status", "nin", ["suspended", "banned"]],
      ]);
    });
  });

  describe("Type-specific permissions", () => {
    it("should handle record-level permissions with type info", () => {
      const permission = [
        { record: "ownerId" },
        "=",
        { user: "id" },
      ] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ record: "ownerId" }, "eq", { user: "_id" }]],
        permit: "allow",
      });
    });

    it("should handle update permissions with oldRecord/newRecord", () => {
      const permission = [
        { oldRecord: "price" },
        "!=",
        { newRecord: "price" },
      ] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ oldRecord: "price" }, "ne", { newRecord: "price" }]],
        permit: "allow",
      });
    });

    it("should handle GQL-level permissions", () => {
      const permission = [
        { user: "role" },
        "=",
        "admin",
      ] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "admin"]],
        permit: "allow",
      });
    });
  });
});

describe("normalizeGqlPermission", () => {
  it("should normalize basic GQL permission with single policy", () => {
    const permission = [
      {
        conditions: [["user.role", "=", "admin"]],
        actions: ["read", "create"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.role", "eq", "admin"]],
        actions: ["read", "create"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should normalize GQL permission with 'all' actions", () => {
    const permission = [
      {
        conditions: [["user.isAdmin", "=", true]],
        actions: "all",
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.isAdmin", "eq", true]],
        actions: ["all"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should normalize GQL permission with deny policy", () => {
    const permission = [
      {
        conditions: [["user.status", "=", "suspended"]],
        actions: ["delete", "update"],
        permit: false,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.status", "eq", "suspended"]],
        actions: ["delete", "update"],
        permit: "deny",
        description: undefined,
      },
    ]);
  });

  it("should preserve description field", () => {
    const permission = [
      {
        conditions: [["user.role", "in", ["admin", "moderator"] as string[]]],
        actions: ["read", "update"],
        permit: true,
        description: "Admin and moderator read/update access",
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.role", "in", ["admin", "moderator"]]],
        actions: ["read", "update"],
        permit: "allow",
        description: "Admin and moderator read/update access",
      },
    ]);
  });

  it("should handle multiple policies", () => {
    const permission = [
      {
        conditions: [["user.role", "=", "admin"]],
        actions: "all",
        permit: true,
      },
      {
        conditions: [["user.role", "=", "viewer"]],
        actions: ["read"],
        permit: true,
      },
      {
        conditions: [["user.status", "=", "banned"]],
        actions: "all",
        permit: false,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.role", "eq", "admin"]],
        actions: ["all"],
        permit: "allow",
        description: undefined,
      },
      {
        conditions: [["user.role", "eq", "viewer"]],
        actions: ["read"],
        permit: "allow",
        description: undefined,
      },
      {
        conditions: [["user.status", "eq", "banned"]],
        actions: ["all"],
        permit: "deny",
        description: undefined,
      },
    ]);
  });

  it("should handle empty conditions array", () => {
    const permission = [
      {
        conditions: [],
        actions: ["read"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [],
        actions: ["read"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should handle multiple conditions in a single policy", () => {
    const permission = [
      {
        conditions: [
          ["user.department", "=", "sales"],
          ["user.role", "in", ["manager", "lead"] as string[]],
          ["user.active", "=", true],
        ],
        actions: ["read", "create", "update"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [
          ["user.department", "eq", "sales"],
          ["user.role", "in", ["manager", "lead"]],
          ["user.active", "eq", true],
        ],
        actions: ["read", "create", "update"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should handle all GQL permission actions", () => {
    const permission = [
      {
        conditions: [["user.role", "=", "superadmin"]],
        actions: [
          "read",
          "create",
          "update",
          "delete",
          "aggregate",
          "bulkUpsert",
        ],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.role", "eq", "superadmin"]],
        actions: [
          "read",
          "create",
          "update",
          "delete",
          "aggregate",
          "bulkUpsert",
        ],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should handle user and record operands in conditions", () => {
    const permission = [
      {
        conditions: [
          [{ user: "id" }, "=", "123"],
          [{ record: "ownerId" }, "=", { user: "id" }],
        ],
        actions: ["update", "delete"],
        permit: true,
      },
    ] as unknown as Parameters<typeof normalizeGqlPermission>[0];
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [
          [{ user: "_id" }, "eq", "123"],
          [{ record: "ownerId" }, "eq", { user: "_id" }],
        ],
        actions: ["update", "delete"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should handle operator transformations", () => {
    const permission = [
      {
        conditions: [
          ["user.status", "=", "active"],
          ["user.country", "!=", "restricted"],
          ["user.roles", "not in", ["blocked", "suspended"] as string[]],
        ],
        actions: ["read"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [
          ["user.status", "eq", "active"],
          ["user.country", "ne", "restricted"],
          ["user.roles", "nin", ["blocked", "suspended"]],
        ],
        actions: ["read"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should handle undefined conditions", () => {
    const permission = [
      {
        actions: ["read"],
        permit: true,
      },
    ] as unknown as Parameters<typeof normalizeGqlPermission>[0];
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [],
        actions: ["read"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  it("should handle default permit value", () => {
    const permission = [
      {
        conditions: [["user.role", "=", "guest"]],
        actions: ["read"],
      },
    ] as unknown as Parameters<typeof normalizeGqlPermission>[0];
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.role", "eq", "guest"]],
        actions: ["read"],
        permit: "deny",
        description: undefined,
      },
    ]);
  });
});
