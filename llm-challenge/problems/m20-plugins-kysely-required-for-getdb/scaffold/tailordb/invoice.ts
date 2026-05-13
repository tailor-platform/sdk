import { db } from "@tailor-platform/sdk";

export const invoice = db.type("Invoice", {
  amount: db.int(),
  status: db.string(),
});
