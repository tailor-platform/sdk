import { db } from "@tailor-platform/sdk";

export const company = db.type("Company", "Company information with nested address and contacts", {
  name: db.string().description("Company legal name"),
  address: db.object({
    street: db.string(),
    city: db.string(),
    state: db.string({ optional: true }),
    zipCode: db.string(),
    country: db.string(),
  }),
  contacts: db.object(
    {
      name: db.string(),
      email: db.string(),
      role: db.string({ optional: true }),
    },
    { array: true },
  ),
  industry: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

export type company = typeof company;
