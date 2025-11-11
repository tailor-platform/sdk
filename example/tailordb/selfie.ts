import { db } from "@tailor-platform/tailor-sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const selfie = db
  .type("Selfie", {
    name: db.string(),
    parentID: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: "self" },
      backward: "children",
    }),
    dependId: db.uuid({ optional: true }).relation({
      type: "1-1",
      toward: { type: "self", as: "dependsOn" },
      backward: "dependedBy",
    }),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
