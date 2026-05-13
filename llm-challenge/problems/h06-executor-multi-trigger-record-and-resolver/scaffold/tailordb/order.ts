import { db } from "@tailor-platform/sdk";

export const order = db.type("Order", {
  customerId: db.string(),
  amount: db.float(),
});
