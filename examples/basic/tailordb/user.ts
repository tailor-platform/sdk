import { db } from "@tailor-platform/tailor-sdk";
import { role } from "./role";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    status: db.string().optional(),
    department: db.string().optional(),
    roleId: db.uuid().relation({
      type: "n-1",
      toward: { type: role },
    }),
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
  .gqlPermission<PermissionUser>(defaultGqlPermission);
export type user = typeof user;
