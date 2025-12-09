import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    name: db.string().unique(),
    role: db.enum(["USER", "ADMIN"]),
    ...db.fields.timestamps(),
  })
  // NOTE: This permits all operations for simplicity.
  // In production, configure proper permissions based on your requirements.
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
