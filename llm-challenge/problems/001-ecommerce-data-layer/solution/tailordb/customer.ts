import { db } from "@tailor-platform/sdk";

export const customer = db.type("Customer", {
  name: db.string(),
  email: db.string().validate([({ value }) => value.includes("@"), "Must contain @"]),
  phone: db.string({ optional: true }),
  address: db.object({
    street: db.string(),
    city: db.string(),
    state: db.string(),
    zipCode: db.string(),
  }),
  ...db.fields.timestamps(),
});
export type customer = typeof customer;
