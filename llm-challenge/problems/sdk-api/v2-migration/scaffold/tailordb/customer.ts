import { db } from "@tailor-platform/sdk";

export const customer = db
  .type("Customer", {
    name: db.string(),
    email: db.string().unique(),
  })
  .files({
    contract: "customer contract",
  });
