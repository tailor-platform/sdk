import { db } from "@tailor-platform/tailor-sdk";
import { permissionManager, User } from "./common/permission";

export const notification = db
  .type("Notification", {
    message: db.string().description("Notification message"),
    ...db.fields.timestamps(),
  })
  .permission<User>(permissionManager)
  .gqlPermission([
    {
      conditions: [[{ user: "role" }, "=", "MANAGER"]],
      actions: ["delete"],
      permit: true,
    },
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read"],
      permit: true,
    },
  ]);
