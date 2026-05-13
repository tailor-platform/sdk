import { db } from "@tailor-platform/sdk";

export const order = db.type("Order", {
  reference: db.string(),
  total: db.int(),
});
