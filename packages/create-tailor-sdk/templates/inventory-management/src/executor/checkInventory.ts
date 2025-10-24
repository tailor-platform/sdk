import {
  createExecutor,
  recordUpdatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { inventory } from "../db/inventory";
import config from "../../tailor.config";
import { getDB } from "../generated/kysely-tailordb";

export default createExecutor(
  "check-inventory",
  "Notify when inventory drops below threshold",
)
  .on(
    recordUpdatedTrigger(
      inventory,
      ({ oldRecord, newRecord }) =>
        oldRecord.quantity >= 10 && newRecord.quantity < 10,
    ),
  )
  .executeFunction({
    fn: async ({ newRecord }) => {
      const db = getDB("main-db");

      await db
        .insertInto("Notification")
        .values({
          message: `Inventory for product ${newRecord.productId} is below threshold. Current quantity: ${newRecord.quantity}`,
        })
        .execute();
    },
    invoker: config.auth.invoker("manager"),
  });
