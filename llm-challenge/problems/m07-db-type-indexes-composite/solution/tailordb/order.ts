import { db } from "@tailor-platform/sdk";

export const order = db
  .type("Order", {
    status: db.string(),
    createdAt: db.datetime(),
  })
  .indexes({ fields: ["status", "createdAt"], unique: false });
