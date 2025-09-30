import {
  TailorTypeGqlPermission,
  TailorTypePermission,
} from "@tailor-platform/tailor-sdk";

export interface User {
  role: string;
}

// Manager can do anything, Staff can only read.
export const permissionManager: TailorTypePermission<User> = {
  create: [[{ user: "role" }, "=", "MANAGER"]],
  read: [[{ user: "_loggedIn" }, "=", true]],
  update: [[{ user: "role" }, "=", "MANAGER"]],
  delete: [[{ user: "role" }, "=", "MANAGER"]],
};

// Manager can perform any GraphQL operations, Staff can only read.
export const gqlPermissionManager: TailorTypeGqlPermission<User> = [
  {
    conditions: [[{ user: "role" }, "=", "MANAGER"]],
    actions: "all",
    permit: true,
  },
  {
    conditions: [[{ user: "_loggedIn" }, "=", true]],
    actions: ["read"],
    permit: true,
  },
];

// Any logged-in user can do anything.
export const permissionLoggedIn: TailorTypePermission<User> = {
  create: [[{ user: "_loggedIn" }, "=", true]],
  read: [[{ user: "_loggedIn" }, "=", true]],
  update: [[{ user: "_loggedIn" }, "=", true]],
  delete: [[{ user: "_loggedIn" }, "=", true]],
};

// Any logged-in user can perform read GraphQL operation.
export const gqlPermissionLoggedIn: TailorTypeGqlPermission<User> = [
  {
    conditions: [[{ user: "_loggedIn" }, "=", true]],
    actions: ["read"],
    permit: true,
  },
];
