import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "../permissions";

export const supplier = db
  .table("Supplier", {
    name: db.string({ optional: true }),
    country: db.string({ optional: true }),
    phone: db.string(),
    state: db.enum(["Alabama", "Alaska"]),
    city: db.string(),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
