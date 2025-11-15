import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const supplier = db
  .type("Supplier", {
    name: db.string(),
    phone: db.string(),
    fax: db.string({ optional: true }),
    email: db.string({ optional: true }),
    postalCode: db.string(),
    country: db.string(),
    state: db.enum("Alabama", "Alaska"),
    city: db.string(),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
