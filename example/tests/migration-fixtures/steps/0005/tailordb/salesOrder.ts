import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "../permissions";

export const salesOrder = db
  .table("SalesOrder", {
    customerID: db.uuid(),
    status: db.string({ optional: true }),
    totalPrice: db.int({ optional: true }),
    ...db.fields.timestamps(),
  })
  .files({
    receipt: "receipt file",
    form: "order form file",
  })
  .indexes(
    { fields: ["status", "createdAt"], unique: false },
    { fields: ["customerID", "status"], unique: false },
  )
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
