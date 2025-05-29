import { db, t } from "@tailor-platform/tailor-sdk";
import { supplier } from "./supplier";

export const purchaseOrder = db.type(
  "PurchaseOrder",
  {
    supplierID: db.uuid().ref(supplier, ["supplier", "purchaseOrder"]),
    totalPrice: db.int(),
    discount: db.float().optional(),
    status: db.string(),
  },
  { withTimestamps: true },
);
export type purchaseOrder = typeof purchaseOrder;
export type PurchaseOrder = t.infer<purchaseOrder>;
