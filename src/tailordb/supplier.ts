import { db, t } from "@tailor-platform/tailor-sdk";

export const supplier = db.type("Supplier", {
  name: db.string(),
  phone: db.string(),
  fax: db.string().optional(),
  email: db.string().optional(),
  postalCode: db.string(),
  country: db.string(),
  state: db.enum("Alabama", "Alaska"),
  city: db.string(),
  ...db.fields.timestamps(),
});
export type supplier = typeof supplier;
export type Supplier = t.infer<supplier>;
