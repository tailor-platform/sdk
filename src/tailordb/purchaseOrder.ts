import { db } from "@tailor-platform/tailor-sdk";
import { supplier } from "./supplier";
import { attachedFiles } from "./file";

export const purchaseOrder = db.type(["PurchaseOrder", "PurchaseOrderList"], {
  supplierID: db.uuid().relation({
    type: "1-n",
    toward: { type: supplier },
  }),
  totalPrice: db.int(),
  discount: db.float().optional(),
  status: db.string(),
  attachedFiles,
  ...db.fields.timestamps(),
});
export type purchaseOrder = typeof purchaseOrder;
