import { db, t } from "@tailor-platform/tailor-sdk";

export const customer = db.type(
  "Customer",
  {
    name: db.string(),
    email: db.string(),
    phone: db.string().optional(),
    address: db.string().optional(),
    city: db
      .string()
      .optional()
      .validate(({ value }) => value.length > 1),
    state: db.string(),
    country: db.string(),
    postalCode: db.string(),
  },
  { withTimestamps: true },
);
export type customer = typeof customer;
export type Customer = t.infer<customer>;
