import { db } from "@tailor-platform/sdk";

export const organization = db
  .type("Organization", {
    name: db.string(),
    domain: db.string().unique(),
    plan: db.enum(["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]),
    billingAddress: db.object({
      street: db.string(),
      city: db.string(),
      state: db.string(),
      postalCode: db.string(),
      country: db.string(),
    }),
    orgCode: db.string().serial({ start: 1, format: "ORG-%04d" }),
    contactEmail: db.string().unique(),
    maxSeats: db.int({ optional: true }),
    active: db.bool(),
    tags: db.string({ optional: true, array: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    contactEmail: { create: ({ value }) => (value ? value.toLowerCase() : "") },
    maxSeats: { create: ({ value }) => value ?? 5 },
  })
  .description("Organizations on the SaaS platform")
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "plan" }, "=", "ENTERPRISE"]],
    delete: [[{ user: "plan" }, "=", "ENTERPRISE"]],
  })
  .gqlPermission([
    { conditions: [[{ user: "plan" }, "=", "ENTERPRISE"]], actions: "all", permit: true },
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read", "create"],
      permit: true,
    },
  ]);
