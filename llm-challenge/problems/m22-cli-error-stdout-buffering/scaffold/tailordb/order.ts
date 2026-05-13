import { db } from "@tailor-platform/sdk";

export const order = db.type("Order", {
  total: db.int(),
  status: db.string(),
});
