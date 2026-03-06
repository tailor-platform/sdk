import { db } from "@tailor-platform/sdk";
import { organization } from "./organization";

export const subscription = db
  .type("Subscription", {
    organizationId: db.uuid().relation({ type: "n-1", toward: { type: organization } }),
    plan: db.enum(["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]),
    status: db.enum(["TRIAL", "ACTIVE", "PAUSED", "CANCELLED"]),
    startDate: db.date(),
    endDate: db.date({ optional: true }),
    monthlyRate: db.float(),
    autoRenew: db.bool(),
    ...db.fields.timestamps(),
  })
  .hooks({
    endDate: {
      update: ({ value, data }) =>
        data.status === "CANCELLED" ? new Date().toISOString().slice(0, 10) : (value as string),
    },
  })
  .validate({
    monthlyRate: [({ value }) => value >= 0, "monthlyRate must be non-negative"],
  })
  .indexes({ fields: ["organizationId", "status"] })
  .features({ aggregation: true });
