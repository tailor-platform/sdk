import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";
import { user } from "./user";

export const userSetting = db
  .type("UserSetting", {
    language: db.enum("jp", "en"),
    userID: db.uuid().relation({
      type: "1-1",
      toward: { type: user },
      backward: "setting",
    }),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
