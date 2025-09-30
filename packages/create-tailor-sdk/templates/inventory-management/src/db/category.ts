import { db } from "@tailor-platform/tailor-sdk";
import {
  gqlPermissionManager,
  permissionManager,
  User,
} from "./common/permission";

export const category = db
  .type("Category", {
    name: db.string().description("Name of the category").unique(),
    description: db
      .string({ optional: true })
      .description("Description of the category"),
    ...db.fields.timestamps(),
  })
  .permission<User>(permissionManager)
  .gqlPermission(gqlPermissionManager);
