import { auth, db } from "../tailor.config";

createResolver({
  name: "orders",
  operation: "query",
  authInvoker: auth.invoker("kiosk"),
  // `auth` is still referenced below, so the import must be preserved.
  ownerType: auth.machineUser,
  body: () => db.table("Order"),
});
