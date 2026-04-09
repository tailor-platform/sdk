import type {
  PermissionCondition,
  TailorTypeGqlPermission,
  TailorTypePermission,
} from "@tailor-platform/sdk";

const managerOnly = [{ user: "role" }, "=", "MANAGER"] as const satisfies PermissionCondition;

export const defaultPermission: TailorTypePermission = {
  create: [managerOnly],
  read: [managerOnly],
  update: [managerOnly],
  delete: [managerOnly],
};

export const defaultGqlPermission: TailorTypeGqlPermission = [
  {
    conditions: [managerOnly],
    actions: ["create", "read", "update", "delete", "aggregate", "bulkUpsert"],
    permit: true,
  },
];
