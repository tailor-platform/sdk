import { db } from "@tailor-platform/tailor-sdk";
import { customer } from "./customer";
import { user } from "./user";
import {
  defaultPermission,
  defaultGqlPermission,
  PermissionUser,
} from "./permissions";

export const salesOrder = db
  .type(["SalesOrder", "SalesOrderList"], {
    customerID: db.uuid().relation({
      type: "n-1",
      toward: { type: customer },
    }),
    approvedByUserIDs: db.uuid({ optional: true, array: true }).relation({
      type: "keyOnly",
      toward: { type: user },
    }),
    totalPrice: db.int({ optional: true }),
    discount: db.float({ optional: true }),
    status: db.string({ optional: true }),
    cancelReason: db.string({ optional: true }),
    canceledAt: db.datetime({ optional: true }),
    ...db.fields.timestamps(),
  })
  .indexes(
    { fields: ["status", "createdAt"], unique: false },
    { fields: ["customerID", "status"], unique: false },
  )
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission(defaultGqlPermission);

export const salesOrderCreated = db
  .type(["SalesOrderCreated", "SalesOrderCreatedList"], {
    salesOrderID: db.uuid(),
    customerID: db.uuid(),
    totalPrice: db.int({ optional: true }),
    status: db.string({ optional: true }),
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission(defaultGqlPermission);
