import { db } from "@tailor-platform/sdk";
import { subscription } from "./subscription";

export const usageRecord = db
  .type("UsageRecord", {
    subscriptionId: db.uuid().relation({ type: "n-1", toward: { type: subscription } }),
    metric: db.string(),
    quantity: db.float(),
    recordedAt: db.datetime({ optional: true }),
    description: db.string({ optional: true }),
    ...db.fields.timestamps(),
  })
  .validate({
    quantity: [({ value }) => value > 0, "quantity must be positive"],
  })
  .hooks({
    recordedAt: { create: () => new Date() },
  });
