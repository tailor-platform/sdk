import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "../permissions";

export const salesOrder = db
  .table("SalesOrder", {
    customerID: db.uuid(),
    status: db.string({ optional: true }),
    totalPrice: db.int({ optional: true }),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
