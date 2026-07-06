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
    quantity: db
      .int()
      .description("Quantity of the product")
      .validate(({ newValue }) => (newValue < 0 ? "Quantity must be non-negative" : undefined)),
    unitPrice: db
      .float()
      .description("Unit price of the product")
      .validate(({ newValue }) => (newValue < 0 ? "Unit price must be non-negative" : undefined)),
    totalPrice: db.float({ optional: true }).description("Total price of the order item"),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ input }) => ({
      totalPrice: (input?.quantity ?? 0) * (input.unitPrice ?? 0),
    }),
    update: ({ input }) => ({
      totalPrice: (input?.quantity ?? 0) * (input.unitPrice ?? 0),
    }),
  })
  .permission(permissionLoggedIn)
  .gqlPermission(gqlPermissionLoggedIn);
