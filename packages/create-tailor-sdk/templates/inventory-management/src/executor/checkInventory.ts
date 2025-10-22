import {
  createExecutor,
  recordUpdatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { inventory } from "../db/inventory";
import { Kysely } from "kysely";
import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { DB } from "../generated/main-db";
import config from "../../tailor.config";

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
      const client = new tailordb.Client({
        namespace: "main-db",
      });
      const db = new Kysely<DB>({
        dialect: new TailordbDialect(client),
      });
      const message = `Inventory for product ${newRecord.productId} is below threshold. Current quantity: ${newRecord.quantity}`;
      await db
        .insertInto("Notification")
        .values({
          message,
        })
        .execute();
    },
    invoker: config.auth.invoker("manager"),
  });
