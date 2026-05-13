import { db } from "@tailor-platform/sdk";

export const customer = db.type("Customer", {
  email: db.string().unique(),
});
