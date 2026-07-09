import { db } from "../tailor.config";

createResolver({
  name: "orders",
  operation: "query",
  authInvoker: "kiosk",
  body: () => db.table("Order"),
});
