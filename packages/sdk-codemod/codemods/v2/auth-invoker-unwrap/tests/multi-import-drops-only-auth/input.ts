import { auth, db } from "../tailor.config";

export const cfg = {
  authInvoker: auth.invoker("kiosk"),
  table: db.type("Order"),
};
