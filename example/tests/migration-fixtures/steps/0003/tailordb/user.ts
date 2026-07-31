import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "../permissions";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
    status: db.string({ optional: true }),
    department: db.string({ optional: true }),
    role: db.enum(["MANAGER"]),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
