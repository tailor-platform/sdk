import { db } from "@tailor-platform/tailor-sdk";
import { contact } from "./contact";
import {
  gqlPermissionLoggedIn,
  permissionLoggedIn,
  User,
} from "./common/permission";

export const order = db
  .type("Order", {
    name: db.string().description("Name of the order"),
    description: db
      .string({ optional: true })
      .description("Description of the order"),
    orderDate: db.datetime().description("Date of the order"),
    orderType: db.enum("PURCHASE", "SALES").description("Type of the order"),
    contactId: db
      .uuid()
      .description("Contact associated with the order")
      .relation({ type: "n-1", toward: { type: contact } }),
    ...db.fields.timestamps(),
  })
  .permission<User>(permissionLoggedIn)
  .gqlPermission(gqlPermissionLoggedIn);
