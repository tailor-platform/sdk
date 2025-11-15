import { db } from "@tailor-platform/sdk";
import { attachedFiles } from "./file";
import { defaultGqlPermission, defaultPermission } from "./permissions";
import { supplier } from "./supplier";

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
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
