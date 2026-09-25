import type {
  PermissionCondition,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@tailor-platform/sdk";

const loggedIn = [{ user: "_loggedIn" }, "=", true] as const satisfies PermissionCondition;
const isAdmin = [{ user: "role" }, "=", "admin"] as const satisfies PermissionCondition;

export const allPermission: TailorTypePermission = {
  create: [loggedIn],
  read: [loggedIn],
  update: [loggedIn],
  delete: [loggedIn],
};

export const rolePermission: TailorTypePermission = {
  create: [isAdmin, loggedIn],
  read: [loggedIn],
  update: [isAdmin, loggedIn],
  delete: [isAdmin],
};

export const allGqlPermission: TailorTypeGqlPermission = [
  {
    conditions: [loggedIn],
    actions: "all",
    permit: true,
  },
];

export const roleGqlPermission: TailorTypeGqlPermission = [
  {
    conditions: [isAdmin],
    actions: ["create", "read", "update", "delete"],
    permit: true,
  },
  {
    conditions: [loggedIn],
    actions: ["read"],
    permit: true,
  },
];
