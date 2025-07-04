import { db, t } from "@tailor-platform/tailor-sdk";

export const customer = db
  .type("Customer", {
    name: db.string(),
    email: db.string(),
    phone: db.string().optional(),
    country: db.string(),
    postalCode: db.string(),
    address: db.string().optional(),
    city: db
      .string()
      .optional()
      .validate(({ value }) => value.length > 1),
    fullAddress: db.string().optional(),
    state: db.string(),
    ...db.fields.timestamps(),
  })
  .hooks({
    fullAddress: {
      create: ({ data }) => `〒${data.postalCode} ${data.address} ${data.city}`,
      update: ({ data }) => `〒${data.postalCode} ${data.address} ${data.city}`,
    },
  });
export type customer = typeof customer;
export type Customer = t.infer<customer>;
