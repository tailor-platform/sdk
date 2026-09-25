import { db } from "../tailor.config";

createResolver({
  name: "orders",
  operation: "query",
  invoker: "kiosk",
  body: () => db.table("Order"),
});
