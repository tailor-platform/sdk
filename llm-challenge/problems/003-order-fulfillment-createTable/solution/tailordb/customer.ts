import { createTable, timestampFields } from "@tailor-platform/sdk";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const customer = createTable(
  "Customer",
  {
    email: { kind: "string", unique: true },
    displayName: { kind: "string" },
    loyaltyTier: { kind: "enum", values: ["BRONZE", "SILVER", "GOLD"], optional: true },
    ...timestampFields(),
  },
  {
    hooks: {
      create: ({ data }) => ({
        ...data,
        email: typeof data.email === "string" ? data.email.toLowerCase() : "",
        loyaltyTier: data.loyaltyTier ?? "BRONZE",
      }),
    },
    validate: [
      [
        ({ data }) => typeof data.email === "string" && EMAIL_REGEX.test(data.email),
        "email must be a valid address",
      ],
      [
        ({ data }) => typeof data.displayName === "string" && data.displayName.length <= 80,
        "displayName must be 80 characters or fewer",
      ],
    ],
  },
);
