import { db } from "@tailor-platform/sdk";

export const invoice = db.type("Invoice", {
  accountId: db.string(),
  amount: db.int(),
});
