import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

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
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission<PermissionUser>(defaultGqlPermission);
export type supplier = typeof supplier;
