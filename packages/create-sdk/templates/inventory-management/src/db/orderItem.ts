import { db } from "@tailor-platform/sdk";
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
    quantity: db.int().description("Quantity of the product"),
    unitPrice: db.float().description("Unit price of the product"),
    totalPrice: db.float({ optional: true }).description("Total price of the order item"),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ data }) => ({
      totalPrice: data.quantity * data.unitPrice,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    update: ({ data }) => ({
      totalPrice: data.quantity * data.unitPrice,
      updatedAt: new Date(),
    }),
  })
  .validate([({ data }) => data.quantity >= 0, ({ data }) => data.unitPrice >= 0])
  .permission(permissionLoggedIn)
  .gqlPermission(gqlPermissionLoggedIn);
