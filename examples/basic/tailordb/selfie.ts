import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const selfie = db
  .type("Selfie", {
    name: db.string(),
    parentID: db
      .uuid()
      .relation({
        type: "n-1",
        toward: { type: "self" },
        backward: "children",
      })
      .optional(),
    dependId: db
      .uuid()
      .relation({
        type: "1-1",
        toward: { type: "self", as: "dependsOn" },
        backward: "dependedBy",
      })
      .optional(),
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission(defaultGqlPermission);
