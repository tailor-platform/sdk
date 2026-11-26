import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const tenant = db
  .table("Tenant", {
    name: db.string(),
    signature: db.string().unique(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
