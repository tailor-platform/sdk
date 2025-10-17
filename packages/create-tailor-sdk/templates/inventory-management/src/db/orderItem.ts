import { db } from "@tailor-platform/tailor-sdk";
import { order } from "./order";
import { product } from "./product";
import { gqlPermissionLoggedIn, permissionLoggedIn } from "./common/permission";

export const orderItem = db
  .type("OrderItem", {
    orderId: db
      .uuid()
      .description("ID of the order")
      .relation({ type: "n-1", toward: { type: order } }),
    productId: db
      .uuid()
      .description("ID of the product")
      .relation({ type: "n-1", toward: { type: product } }),
    quantity: db
      .int()
      .description("Quantity of the product")
      .validate(({ value }) => value >= 0),
    unitPrice: db
      .float()
      .description("Unit price of the product")
      .validate(({ value }) => value >= 0),
    totalPrice: db
      .float({ optional: true, assertNonNull: true })
      .description("Total price of the order item"),
    ...db.fields.timestamps(),
  })
  .hooks({
    totalPrice: {
      create: ({ data }) => data.quantity * data.unitPrice,
      update: ({ data }) => data.quantity * data.unitPrice,
    },
  })
  .permission(permissionLoggedIn)
  .gqlPermission(gqlPermissionLoggedIn);
