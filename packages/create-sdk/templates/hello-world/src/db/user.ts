import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string().description("Name of the user"),
    email: db.string().unique().description("Email address of the user"),
    role: db.enum(["MANAGER", "STAFF"]),
    ...db.fields.timestamps(),
  })
  .features({
    gqlOperations: "query",
  })
  // This template defines no auth, so its data is public by design.
  // In production, define conditions in .permission() / .gqlPermission() instead.
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
