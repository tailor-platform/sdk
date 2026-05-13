import { db } from "@tailor-platform/sdk";

export const product = db
  .type("Product", {
    price: db.float(),
  })
  .validate({
    price: [({ value }) => value >= 0, "price must be >= 0"],
  });
