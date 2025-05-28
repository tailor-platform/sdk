import { t } from "@tailor-platform/tailor-sdk";

export const supplier = t.dbType(
  "Supplier",
  {
    name: t.string(),
    phone: t.string(),
    fax: t.string().optional(),
    email: t.string().optional(),
    postalCode: t.string(),
    country: t.string(),
    state: t.enum(["Alabama", "Alaska"]),
    city: t.string(),
  },
  { withTimestamps: true },
);
export type supplier = typeof supplier;
export type Supplier = t.infer<supplier>;
