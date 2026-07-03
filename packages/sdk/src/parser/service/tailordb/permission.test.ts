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
    test.each<[string, Permission, unknown[], string]>([
      [
        "without permit (defaults to true)",
        ["user.id", "=", "123"] as Permission,
        ["user.id", "eq", "123"],
        "allow",
      ],
      [
        "with permit=true",
        ["user.id", "=", "123", true] as Permission,
        ["user.id", "eq", "123"],
        "allow",
      ],
      [
        "with permit=false",
        ["user.id", "!=", "123", false] as Permission,
        ["user.id", "ne", "123"],
        "deny",
      ],
      [
        "with array values in conditions",
        ["user.role", "in", ["admin", "manager"] as string[]] as Permission,
        ["user.role", "in", ["admin", "manager"]],
        "allow",
      ],
      [
        "with user operand",
        [{ user: "role" }, "=", "admin"] as unknown as Permission,
        [{ user: "role" }, "eq", "admin"],
        "allow",
      ],
      [
        "with record operand",
        [{ record: "status" }, "=", "active"] as unknown as Permission,
        [{ record: "status" }, "eq", "active"],
        "allow",
      ],
      [
        "with oldRecord/newRecord operands for update",
        [{ oldRecord: "status" }, "!=", { newRecord: "status" }] as unknown as Permission,
        [{ oldRecord: "status" }, "ne", { newRecord: "status" }],
        "allow",
      ],
    ])("should normalize single condition %s", (_name, permission, expectedCondition, permit) => {
      const result = normalizeActionPermission(permission);
      expect(result).toEqual({
        conditions: [expectedCondition],
        permit,
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
    test.each([
      [
        "'not in'",
        ["user.status", "not in", ["suspended", "banned"] as string[]] as const,
        ["user.status", "nin", ["suspended", "banned"]],
      ],
      [
        "'hasAny'",
        [{ user: "roles" }, "hasAny", ["admin", "manager"]],
        [{ user: "roles" }, "hasAny", ["admin", "manager"]],
      ],
      [
        "'not hasAny'",
        [{ user: "roles" }, "not hasAny", ["blocked"]],
        [{ user: "roles" }, "nhasAny", ["blocked"]],
      ],
    ])("should handle %s operator", (_name, permission, expectedCondition) => {
      const result = normalizeActionPermission(permission);
      expect(result.conditions).toEqual([expectedCondition]);
    });
  });
});

describe("normalizeGqlPermission", () => {
  test.each([
    [
      "basic GQL permission with single policy",
      [
        {
          conditions: [["user.role", "=", "admin"]],
          actions: ["read", "create"],
          permit: true,
        },
      ] as const,
      [
        {
          conditions: [["user.role", "eq", "admin"]],
          actions: ["read", "create"],
          permit: "allow",
          description: undefined,
        },
      ],
    ],
    [
      "GQL permission with 'all' actions",
      [
        {
          conditions: [["user.isAdmin", "=", true]],
          actions: "all",
          permit: true,
        },
      ] as const,
      [
        {
          conditions: [["user.isAdmin", "eq", true]],
          actions: ["all"],
          permit: "allow",
          description: undefined,
        },
      ],
    ],
    [
      "GQL permission with deny policy",
      [
        {
          conditions: [["user.status", "=", "suspended"]],
          actions: ["delete", "update"],
          permit: false,
        },
      ] as const,
      [
        {
          conditions: [["user.status", "eq", "suspended"]],
          actions: ["delete", "update"],
          permit: "deny",
          description: undefined,
        },
      ],
    ],
    [
      "description field",
      [
        {
          conditions: [["user.role", "in", ["admin", "moderator"] as string[]]],
          actions: ["read", "update"],
          permit: true,
          description: "Admin and moderator read/update access",
        },
      ] as const,
      [
        {
          conditions: [["user.role", "in", ["admin", "moderator"]]],
          actions: ["read", "update"],
          permit: "allow",
          description: "Admin and moderator read/update access",
        },
      ],
    ],
    [
      "multiple policies",
      [
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
      ] as const,
      [
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
      ],
    ],
    [
      "empty conditions array",
      [
        {
          conditions: [],
          actions: ["read"],
          permit: true,
        },
      ] as const,
      [
        {
          conditions: [],
          actions: ["read"],
          permit: "allow",
          description: undefined,
        },
      ],
    ],
    [
      "multiple conditions in a single policy",
      [
        {
          conditions: [
            ["user.department", "=", "sales"],
            ["user.role", "in", ["manager", "lead"] as string[]],
            ["user.active", "=", true],
          ],
          actions: ["read", "create", "update"],
          permit: true,
        },
      ] as const,
      [
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
      ],
    ],
    [
      "all GQL permission actions",
      [
        {
          conditions: [["user.role", "=", "superadmin"]],
          actions: ["read", "create", "update", "delete", "aggregate", "bulkUpsert"],
          permit: true,
        },
      ] as const,
      [
        {
          conditions: [["user.role", "eq", "superadmin"]],
          actions: ["read", "create", "update", "delete", "aggregate", "bulkUpsert"],
          permit: "allow",
          description: undefined,
        },
      ],
    ],
    [
      "operator transformations",
      [
        {
          conditions: [
            ["user.status", "=", "active"],
            ["user.country", "!=", "restricted"],
            ["user.roles", "not in", ["blocked", "suspended"] as string[]],
          ],
          actions: ["read"],
          permit: true,
        },
      ] as const,
      [
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
      ],
    ],
    [
      "hasAny operator in GQL permission",
      [
        {
          conditions: [[{ user: "roles" }, "hasAny", ["admin", "manager"] as string[]]],
          actions: ["read", "update"],
          permit: true,
        },
      ] as const,
      [
        {
          conditions: [[{ user: "roles" }, "hasAny", ["admin", "manager"]]],
          actions: ["read", "update"],
          permit: "allow",
          description: undefined,
        },
      ],
    ],
    [
      "nhasAny operator in GQL permission",
      [
        {
          conditions: [[{ user: "roles" }, "not hasAny", ["blocked"] as string[]]],
          actions: ["read"],
          permit: true,
        },
      ] as const,
      [
        {
          conditions: [[{ user: "roles" }, "nhasAny", ["blocked"]]],
          actions: ["read"],
          permit: "allow",
          description: undefined,
        },
      ],
    ],
  ])("should normalize %s", (_name, permission, expected) => {
    const result = normalizeGqlPermission(permission);
    expect(result).toEqual(expected);
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
