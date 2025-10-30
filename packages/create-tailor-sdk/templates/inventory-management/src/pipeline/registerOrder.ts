import { createResolver, t } from "@tailor-platform/tailor-sdk";
import { order } from "../db/order";
import { orderItem } from "../db/orderItem";
import { type DB, getDB } from "../generated/kysely-tailordb";

const input = t
  .type({
    order: t
      .object({
        name: order.fields.name,
        description: order.fields.description,
        orderDate: order.fields.orderDate,
        orderType: order.fields.orderType,
        contactId: order.fields.contactId,
      })
      .description("Order information"),
    items: t
      .object(
        {
          productId: orderItem.fields.productId,
          quantity: orderItem.fields.quantity,
          unitPrice: orderItem.fields.unitPrice,
        },
        { array: true },
      )
      .description("Order items"),
  })
  .description("Input parameters for registering a new order");
type Input = t.infer<typeof input>;

const insertOrder = async (db: DB<"main-db">, input: Input) => {
  // Insert Order
  const order = await db
    .insertInto("Order")
    .values({
      name: input.order.name,
      description: input.order.description,
      orderDate: input.order.orderDate,
      orderType: input.order.orderType,
      contactId: input.order.contactId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // Insert OrderItems
  await db
    .insertInto("OrderItem")
    .values(
      input.items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    )
    .execute();
};

const updateInventory = async (db: DB<"main-db">, input: Input) => {
  for (const item of input.items) {
    const inventory = await db
      .selectFrom("Inventory")
      .selectAll()
      .where("productId", "=", item.productId)
      .forUpdate()
      .executeTakeFirst();

    // If inventory already exists, update it.
    // Otherwise, create it (only for PURCHASE order).
    if (inventory) {
      let quantity: number;
      if (input.order.orderType === "PURCHASE") {
        quantity = inventory.quantity + item.quantity;
      } else {
        quantity = inventory.quantity - item.quantity;
      }
      if (quantity < 0) {
        throw new Error(
          `Cannot create order because inventory is not enough. productId: ${item.productId}`,
        );
      }
      await db
        .updateTable("Inventory")
        .set({ quantity })
        .where("id", "=", inventory.id)
        .execute();
    } else {
      if (input.order.orderType === "PURCHASE") {
        await db
          .insertInto("Inventory")
          .values({
            productId: item.productId,
            quantity: item.quantity,
          })
          .execute();
      } else {
        throw new Error(
          `Cannot create order because inventory is not enough. productId: ${item.productId}`,
        );
      }
    }
  }
};

export default createResolver({
  name: "registerOrder",
  operation: "mutation",
  input,
  body: async (context) => {
    const db = getDB("main-db");
    await db.transaction().execute(async (trx) => {
      await insertOrder(trx, context.input);
      await updateInventory(trx, context.input);
    });
    return { success: true };
  },
  output: t
    .type({
      success: t
        .bool()
        .description("Whether the order was registered successfully"),
    })
    .description("Result of order registration"),
});
