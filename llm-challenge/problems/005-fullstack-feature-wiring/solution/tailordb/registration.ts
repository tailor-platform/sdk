import { db } from "@tailor-platform/sdk";
import type {
  TailorTypePermission,
  TailorTypeGqlPermission,
  PermissionCondition,
} from "@tailor-platform/sdk";

const loggedIn = [{ user: "_loggedIn" }, "=", true] as const satisfies PermissionCondition;
const isAdmin = [{ user: "role" }, "=", "admin"] as const satisfies PermissionCondition;

const permission: TailorTypePermission = {
  create: [loggedIn],
  read: [loggedIn],
  update: [isAdmin],
  delete: [isAdmin],
};

const gqlPermission: TailorTypeGqlPermission = [
  {
    conditions: [isAdmin],
    actions: "all",
    permit: true,
  },
  {
    conditions: [loggedIn],
    actions: ["read", "create"],
    permit: true,
  },
];

export const registration = db
  .type("Registration", {
    email: db.string().unique(),
    name: db.string(),
    plan: db.enum(["free", "basic", "premium", "enterprise"]),
    role: db.enum(["user", "admin"]),
    userId: db.uuid({ optional: true }),
    status: db.enum(["pending", "active", "suspended"]),
    referralCode: db.string({ optional: true }),
    ...db.fields.timestamps(),
  })
  .indexes(
    { fields: ["email", "status"], unique: true },
    { fields: ["status", "plan"], unique: false },
  )
  .features({ aggregation: true })
  .permission(permission)
  .gqlPermission(gqlPermission);

export type registration = typeof registration;
