import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    role: db.string({ optional: true }),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
