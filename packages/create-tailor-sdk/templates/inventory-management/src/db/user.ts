import { db } from "@tailor-platform/tailor-sdk";
import {
  gqlPermissionManager,
  permissionManager,
  User,
} from "./common/permission";

export const user = db
  .type("User", {
    name: db.string().description("Name of the user"),
    email: db.string().unique().description("Email address of the user"),
    role: db.enum("MANAGER", "STAFF"),
    ...db.fields.timestamps(),
  })
  .permission<User>(permissionManager)
  .gqlPermission(gqlPermissionManager);
