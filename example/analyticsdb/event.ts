import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "../tailordb/permissions";

export const event = db
  .type("Event", {
    name: db.enum(["CLICK", "VIEW", "PURCHASE"]),
    ...db.fields.timestamps(),
  })
  .files({
    screenshot: "screenshot image",
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
