import { auth, db } from "../tailor.config";

export const cfg = {
  invoker: "kiosk",
  // `auth` is still referenced below, so the import must be preserved.
  ownerType: auth.machineUser,
  table: db.type("Order"),
};
