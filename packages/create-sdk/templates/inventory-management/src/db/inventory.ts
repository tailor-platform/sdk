import { db } from "@tailor-platform/sdk";
import { gqlPermissionLoggedIn, permissionLoggedIn } from "./common/permission";
import { product } from "./product";

export const inventory = db
  .type("Inventory", {
    productId: db
      .uuid()
      .description("ID of the product")
      .relation({ type: "1-1", toward: { type: product } }),
    quantity: db
      .int()
      .description("Quantity of the product in inventory")
      .validate(({ value }) => value >= 0),
    ...db.fields.timestamps(),
  })
  .permission(permissionLoggedIn)
  .gqlPermission(gqlPermissionLoggedIn);
