import type {
  PermissionCondition,
  TailorTypeGqlPermission,
  TailorTypePermission,
} from "@tailor-platform/tailor-sdk";

export interface User {
  role: string;
}

export const managerRole = [
  { user: "role" },
  "=",
  "MANAGER",
] as const satisfies PermissionCondition<"record" | "gql">;
export const loggedIn = [
  { user: "_loggedIn" },
  "=",
  true,
] as const satisfies PermissionCondition<"record" | "gql">;

// Manager can do anything, Staff can only read.
export const permissionManager: TailorTypePermission = {
  create: [managerRole],
  read: [loggedIn],
  update: [managerRole],
  delete: [managerRole],
};

// Manager can perform any GraphQL operations, Staff can only read.
export const gqlPermissionManager: TailorTypeGqlPermission = [
  {
    conditions: [managerRole],
    actions: "all",
    permit: true,
  },
  {
    conditions: [loggedIn],
    actions: ["read"],
    permit: true,
  },
];

// Any logged-in user can do anything.
export const permissionLoggedIn: TailorTypePermission = {
  create: [loggedIn],
  read: [loggedIn],
  update: [loggedIn],
  delete: [loggedIn],
};

// Any logged-in user can perform read GraphQL operation.
export const gqlPermissionLoggedIn: TailorTypeGqlPermission = [
  {
    conditions: [loggedIn],
    actions: ["read"],
    permit: true,
  },
];
