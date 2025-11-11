import type {
  PermissionCondition,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@tailor-platform/tailor-sdk";

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
