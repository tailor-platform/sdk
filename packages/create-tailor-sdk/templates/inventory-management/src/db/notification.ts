import { db } from "@tailor-platform/tailor-sdk";
import { loggedIn, managerRole, permissionManager } from "./common/permission";

export const notification = db
  .type("Notification", {
    message: db.string().description("Notification message"),
    ...db.fields.timestamps(),
  })
  .permission(permissionManager)
  .gqlPermission([
    {
      conditions: [managerRole],
      actions: ["delete"],
      permit: true,
    },
    {
      conditions: [loggedIn],
      actions: ["read"],
      permit: true,
    },
  ]);
