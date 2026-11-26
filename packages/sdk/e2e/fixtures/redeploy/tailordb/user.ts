import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string().unique(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
