import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";
import { user } from "./user";

export const userLog = db
  .type("UserLog", {
    userID: db.uuid().relation({ type: "n-1", toward: { type: user } }),
    message: db.string(),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
