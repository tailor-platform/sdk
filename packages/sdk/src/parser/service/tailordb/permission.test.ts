import { describe, expect, test } from "vitest";
import {
  findOmittedPermitRules,
  normalizeActionPermission,
  normalizeGqlPermission,
} from "./permission";

type Permission = Parameters<typeof normalizeActionPermission>[0];

describe("normalizeActionPermission", () => {
  describe("Object format", () => {
    test("should return object format as-is", () => {
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

    test("should preserve description field", () => {
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

    test("should handle single condition in object format", () => {
      const permission = {
        conditions: ["user.id", "=", "123"],
        permit: true,
      } as Permission;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([["user.id", "eq", "123"]]);
    });

    test("defaults permit to deny when omitted (unlike the array shorthand)", () => {
      const permission = {
        conditions: [["user.id", "=", "123"]],
      } as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "eq", "123"]],
        permit: "deny",
        description: undefined,
      });
    });
  });

  describe("Single condition array format", () => {
    test("should normalize single condition without permit (defaults to true)", () => {
      const permission = ["user.id", "=", "123"] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "eq", "123"]],
        permit: "allow",
      });
    });

    test("should normalize single condition with permit=true", () => {
      const permission = ["user.id", "=", "123", true] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "eq", "123"]],
        permit: "allow",
      });
    });

    test("should normalize single condition with permit=false", () => {
      const permission = ["user.id", "!=", "123", false] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.id", "ne", "123"]],
        permit: "deny",
      });
    });

    test("should handle array values in conditions", () => {
      const permission = ["user.role", "in", ["admin", "manager"] as string[]] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [["user.role", "in", ["admin", "manager"]]],
        permit: "allow",
      });
    });

    test("should handle user operand", () => {
      const permission = [{ user: "role" }, "=", "admin"] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ user: "role" }, "eq", "admin"]],
        permit: "allow",
      });
    });

    test("should handle record operand", () => {
      const permission = [{ record: "status" }, "=", "active"] as unknown as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [[{ record: "status" }, "eq", "active"]],
        permit: "allow",
      });
    });

    test("should handle oldRecord/newRecord operands for update", () => {
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
    test("should normalize array of conditions without permit (all default to true)", () => {
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

    test("should normalize array of conditions with mixed permit values", () => {
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

    test("should handle empty array of conditions", () => {
      const permission = [] as Permission;
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [],
        permit: "allow",
      });
    });

    test("should handle complex nested conditions", () => {
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
    test("should handle 'not in' operator", () => {
      const permission = ["user.status", "not in", ["suspended", "banned"] as string[]] as const;
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([["user.status", "nin", ["suspended", "banned"]]]);
    });

    test("should handle 'hasAny' operator", () => {
      const permission = [{ user: "roles" }, "hasAny", ["admin", "manager"]];
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([[{ user: "roles" }, "hasAny", ["admin", "manager"]]]);
    });

    test("should handle 'not hasAny' operator", () => {
      const permission = [{ user: "roles" }, "not hasAny", ["blocked"]];
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([[{ user: "roles" }, "nhasAny", ["blocked"]]]);
    });
  });
});

describe("normalizeGqlPermission", () => {
  test("should normalize basic GQL permission with single policy", () => {
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

  test("should normalize GQL permission with 'all' actions", () => {
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

  test("should normalize GQL permission with deny policy", () => {
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

  test("should preserve description field", () => {
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

  test("should handle multiple policies", () => {
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

  test("should handle empty conditions array", () => {
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

  test("should handle multiple conditions in a single policy", () => {
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

  test("should handle all GQL permission actions", () => {
    const permission = [
      {
        conditions: [["user.role", "=", "superadmin"]],
        actions: ["read", "create", "update", "delete", "aggregate", "bulkUpsert"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [["user.role", "eq", "superadmin"]],
        actions: ["read", "create", "update", "delete", "aggregate", "bulkUpsert"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  test("should handle user and record operands in conditions", () => {
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

  test("should handle operator transformations", () => {
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

  test("should handle hasAny operator in GQL permission", () => {
    const permission = [
      {
        conditions: [[{ user: "roles" }, "hasAny", ["admin", "manager"] as string[]]],
        actions: ["read", "update"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [[{ user: "roles" }, "hasAny", ["admin", "manager"]]],
        actions: ["read", "update"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  test("should handle nhasAny operator in GQL permission", () => {
    const permission = [
      {
        conditions: [[{ user: "roles" }, "not hasAny", ["blocked"] as string[]]],
        actions: ["read"],
        permit: true,
      },
    ] as const;
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual([
      {
        conditions: [[{ user: "roles" }, "nhasAny", ["blocked"]]],
        actions: ["read"],
        permit: "allow",
        description: undefined,
      },
    ]);
  });

  test("should handle undefined conditions", () => {
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

  test("defaults permit to deny when omitted", () => {
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

describe("findOmittedPermitRules", () => {
  type RawPermissions = Parameters<typeof findOmittedPermitRules>[0];

  test("flags object-form record rules that omit permit", () => {
    const result = findOmittedPermitRules({
      record: {
        read: [{ conditions: [["user.id", "=", "123"]] }],
        create: [{ conditions: [["user.role", "=", "admin"]], permit: true }],
      },
    } as unknown as RawPermissions);
    expect(result).toEqual(["record.read[0]"]);
  });

  test("flags single-array object form and reports every offending action", () => {
    const result = findOmittedPermitRules({
      record: {
        read: [{ conditions: ["user.id", "=", "123"] }],
        delete: [{ conditions: [["user.role", "=", "admin"]] }],
      },
    } as unknown as RawPermissions);
    expect(result).toEqual(["record.read[0]", "record.delete[0]"]);
  });

  test("ignores array-shorthand rules (they default to allow)", () => {
    const result = findOmittedPermitRules({
      record: {
        read: [["user.id", "=", "123"]],
      },
    } as unknown as RawPermissions);
    expect(result).toEqual([]);
  });

  test("flags gql policies that omit permit", () => {
    const result = findOmittedPermitRules({
      gql: [
        { conditions: [["user.role", "=", "guest"]], actions: ["read"] },
        { conditions: [["user.role", "=", "admin"]], actions: "all", permit: false },
      ],
    } as unknown as RawPermissions);
    expect(result).toEqual(["gql[0]"]);
  });

  test("returns empty when every rule sets permit explicitly", () => {
    const result = findOmittedPermitRules({
      record: { read: [{ conditions: [["user.id", "=", "1"]], permit: true }] },
      gql: [{ conditions: [], actions: ["read"], permit: true }],
    } as unknown as RawPermissions);
    expect(result).toEqual([]);
  });

  test("returns empty for empty permissions", () => {
    expect(findOmittedPermitRules({} as unknown as RawPermissions)).toEqual([]);
  });
});
