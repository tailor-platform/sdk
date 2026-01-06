import { db } from "@tailor-platform/sdk";
import { category } from "./category";
import { gqlPermissionManager, permissionManager } from "./common/permission";

export const product = db
  .type("Product", {
    name: db.string().description("Name of the product"),
    description: db.string({ optional: true }).description("Description of the product"),
    categoryId: db
      .uuid()
      .description("ID of the category the product belongs to")
      .relation({ type: "n-1", toward: { type: category } }),
    ...db.fields.timestamps(),
  })
  .permission(permissionManager)
  .gqlPermission(gqlPermissionManager);
