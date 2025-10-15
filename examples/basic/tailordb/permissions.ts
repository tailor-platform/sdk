import type {
  PermissionCondition,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@tailor-platform/tailor-sdk";

const defaultMachineUser = [
  { user: "role" },
  "=",
  "ADMIN",
] as const satisfies PermissionCondition<"record" | "gql">;
const loggedIn = [
  { user: "_loggedIn" },
  "=",
  true,
] as const satisfies PermissionCondition<"record" | "gql">;

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
