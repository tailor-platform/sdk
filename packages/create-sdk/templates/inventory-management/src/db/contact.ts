import { db } from "@tailor-platform/sdk";
import { gqlPermissionManager, permissionManager } from "./common/permission";

export const contact = db
  .type("Contact", {
    name: db.string().description("Name of the contact"),
    email: db.string().unique().description("Email address of the contact"),
    phone: db
      .string({ optional: true })
      .description("Phone number of the contact"),
    address: db
      .string({ optional: true })
      .description("Address of the contact"),
    ...db.fields.timestamps(),
  })
  .permission(permissionManager)
  .gqlPermission(gqlPermissionManager);
