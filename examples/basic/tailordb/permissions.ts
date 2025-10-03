import type {
  PermissionCondition,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@tailor-platform/tailor-sdk";

export interface PermissionUser {
  role: string;
}
const defaultMachineUser = [
  { user: "role" },
  "=",
  "ADMIN",
] as const satisfies PermissionCondition<"record" | "gql", PermissionUser>;
const loggedIn = [
  { user: "_loggedIn" },
  "=",
  true,
] as const satisfies PermissionCondition<"record" | "gql", PermissionUser>;

export const defaultPermission: TailorTypePermission<PermissionUser> = {
  create: [defaultMachineUser],
  read: [defaultMachineUser, loggedIn],
  update: [defaultMachineUser],
  delete: [defaultMachineUser],
};

export const defaultGqlPermission: TailorTypeGqlPermission<PermissionUser> = [
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
