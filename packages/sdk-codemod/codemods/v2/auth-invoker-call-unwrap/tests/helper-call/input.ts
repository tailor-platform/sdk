import { auth, db } from "../tailor.config";

createResolver({
  name: "orders",
  operation: "query",
  authInvoker: auth.invoker("kiosk"),
  body: () => db.table("Order"),
});
