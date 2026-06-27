import { db } from "@tailor-platform/sdk";
import { customer } from "./customer";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const customerNote = db
  .type("CustomerNote", {
    customerID: db.uuid().relation({
      type: "n-1",
      toward: { type: customer },
    }),
    body: db.string(),
    visibility: db.enum(["internal", "shared"], { optional: true }),
    ...db.fields.timestamps(),
  })
  .indexes({ fields: ["customerID", "createdAt"], unique: false })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
