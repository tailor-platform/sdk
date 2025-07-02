import { db, t } from "@tailor-platform/tailor-sdk";
import { supplier } from "./supplier";
import { attachedFiles } from "./file";

export const purchaseOrder = db.type(
  "PurchaseOrder",
  {
    supplierID: db.uuid().relation({
      type: "1-n",
      toward: { type: supplier },
    }),
    totalPrice: db.int(),
    discount: db.float().optional(),
    status: db.string(),
    attachedFiles,
  },
  { withTimestamps: true },
);
export type purchaseOrder = typeof purchaseOrder;
export type PurchaseOrder = t.infer<purchaseOrder>;
