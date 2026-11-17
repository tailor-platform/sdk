import { db, type PermissionCondition } from "@tailor-platform/sdk";

const admin = [{ user: "role" }, "=", "ADMIN"] as const satisfies PermissionCondition;
const loggedIn = [{ user: "_loggedIn" }, "=", true] as const satisfies PermissionCondition;

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string().unique(),
    role: db.enum(["ADMIN", "MEMBER"]),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [admin],
    read: [loggedIn],
    update: [admin],
    delete: [admin],
  })
  .gqlPermission([
    { conditions: [admin], actions: "all", permit: true },
    { conditions: [loggedIn], actions: ["read"], permit: true },
  ]);
