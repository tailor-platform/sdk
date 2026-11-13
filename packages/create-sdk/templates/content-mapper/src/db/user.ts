import { db } from "@tailor-platform/sdk";

const admin = [{ user: "role" }, "=", "ADMIN"] as const;
const loggedIn = [{ user: "_loggedIn" }, "=", true] as const;

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string().unique(),
    role: db.enum(["ADMIN", "MEMBER"]),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [admin],
    read: [admin, loggedIn],
    update: [admin],
    delete: [admin],
  })
  .gqlPermission([
    { conditions: [admin], actions: "all", permit: true },
    { conditions: [loggedIn], actions: ["read"], permit: true },
  ]);
