import { db } from "@tailor-platform/sdk";
import { user } from "./user";

export const order = db.type("Order", {
  title: db.string(),
  amount: db.int(),
  userID: db.uuid().relation({ type: "n-1", toward: { type: user } }),
  ...db.fields.timestamps(),
});
