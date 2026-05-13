import { db } from "@tailor-platform/sdk";

const allowedPlans = new Set(["basic", "pro", "enterprise"]);

export const subscription = db
  .type("Subscription", {
    plan: db.string(),
    price: db.float(),
  })
  .validate({
    plan: [({ value }) => allowedPlans.has(value), "plan not allowed"],
    price: [({ value }) => value >= 0, "price must be >= 0"],
  });
