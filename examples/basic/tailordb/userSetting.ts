import { db } from "@tailor-platform/tailor-sdk";
import { user } from "./user";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

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
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission<PermissionUser>(defaultGqlPermission);
export type userSetting = typeof userSetting;
