import type {
  PermissionCondition,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@tailor-platform/sdk";

const defaultMachineUser = [
  { user: "role" },
  "=",
  "MANAGER",
] as const satisfies PermissionCondition;

const loggedIn = [
  { user: "_loggedIn" },
  "=",
  true,
] as const satisfies PermissionCondition;

export const defaultPermission: TailorTypePermission = {
  create: [defaultMachineUser],
  read: [defaultMachineUser, loggedIn],
  update: [defaultMachineUser],
  delete: [defaultMachineUser],
};

export const defaultGqlPermission: TailorTypeGqlPermission = [
  {
    conditions: [defaultMachineUser],
    actions: ["create", "read", "update", "delete", "aggregate", "bulkUpsert"],
    permit: true,
  },
  {
    conditions: [loggedIn],
    actions: ["read"],
    permit: true,
  },
];

/**
 * For development or testing, if you want to allow all access (unsafe),
 * you can use the following example instead of the default permissions
 * defined above. Do not use this in production environments.
 *
 * Example:
 *
 * import {
 *   unsafeAllowAllTypePermission,
 *   unsafeAllowAllGqlPermission,
 * } from "@tailor-platform/sdk";
 *
 * export const defaultPermission = unsafeAllowAllTypePermission;
 * export const defaultGqlPermission = unsafeAllowAllGqlPermission;
 */
