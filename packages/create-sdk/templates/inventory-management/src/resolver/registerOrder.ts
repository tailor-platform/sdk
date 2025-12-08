import { createResolver, t } from "@tailor-platform/sdk";
import { order } from "../db/order";
import { orderItem } from "../db/orderItem";
import { type DB, getDB } from "../generated/kysely-tailordb";

const input = {
  order: t.object(order.omitFields(["id", "createdAt"])),
  items: t.object(orderItem.omitFields(["id", "createdAt"]), { array: true }),
};
interface Input {
  order: t.infer<typeof input.order>;
  items: t.infer<typeof input.items>;
}

const insertOrder = async (db: DB<"main-db">, input: Input) => {
  // Insert Order
  const order = await db
    .insertInto("Order")
    .values(input.order)
    .returning("id")
    .executeTakeFirstOrThrow();

  // Insert OrderItems
  await db
    .insertInto("OrderItem")
    .values(
      input.items.map((item) => ({
        ...item,
        orderId: order.id,
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
    .object({
      success: t
        .bool()
        .description("Whether the order was registered successfully"),
    })
    .description("Result of order registration"),
});
