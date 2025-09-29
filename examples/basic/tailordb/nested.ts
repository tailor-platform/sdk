import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const nestedProfile = db
  .type("NestedProfile", {
    userInfo: db.object({
      name: db.string(),
      age: db.int({ optional: true }),
      bio: db.string({ optional: true }),
      email: db.string(),
      phone: db.string({ optional: true }),
    }),
    metadata: db.object({
      created: db.datetime(),
      lastUpdated: db.datetime({ optional: true }),
      version: db.int(),
    }),
    archived: db.bool({ optional: true }),
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission<PermissionUser>(defaultGqlPermission);
