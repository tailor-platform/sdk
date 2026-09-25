import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const seedTarget = db
  .table("SeedTarget", { name: db.string() })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
