import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "../permissions";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
