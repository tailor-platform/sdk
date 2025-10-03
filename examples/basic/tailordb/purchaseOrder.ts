import { db } from "@tailor-platform/tailor-sdk";
import { supplier } from "./supplier";
import { attachedFiles } from "./file";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const purchaseOrder = db
  .type(["PurchaseOrder", "PurchaseOrderList"], {
    supplierID: db.uuid().relation({
      type: "n-1",
      toward: { type: supplier },
    }),
    totalPrice: db.int(),
    discount: db.float({ optional: true }),
    status: db.string(),
    attachedFiles,
    ...db.fields.timestamps(),
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission(defaultGqlPermission);
