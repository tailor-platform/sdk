import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    status: db.string({ optional: true }),
    department: db.string({ optional: true }),
    role: db.enum("ADMIN", "USER"),
    ...db.fields.timestamps(),
  })
  .files({
    avatar: "profile image",
  })
  .indexes(
    { fields: ["name", "department"], unique: false },
    {
      fields: ["status", "createdAt"],
      unique: false,
      name: "user_status_created_idx",
    },
  )
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission(defaultGqlPermission);
