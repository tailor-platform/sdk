import { db } from "@tailor-platform/sdk";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const customer = db
  .type("Customer", {
    email: db.string().unique(),
    displayName: db.string(),
    loyaltyTier: db.enum(["BRONZE", "SILVER", "GOLD"], { optional: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    email: {
      create: ({ value }) => (typeof value === "string" ? value.toLowerCase() : ""),
    },
    loyaltyTier: {
      create: ({ value }) => value ?? "BRONZE",
    },
  })
  .validate({
    email: [
      ({ value }) => typeof value === "string" && EMAIL_REGEX.test(value),
      "email must be a valid address",
    ],
    displayName: [
      ({ value }) => typeof value === "string" && value.length <= 80,
      "displayName must be 80 characters or fewer",
    ],
  });
