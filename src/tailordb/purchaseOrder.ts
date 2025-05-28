import { t } from "@tailor-platform/tailor-sdk";
import { supplier } from './supplier';

export const purchaseOrder = t.dbType(
  "PurchaseOrder",
  {
    supplierID: t.uuid().ref(supplier, ["supplier", "purchaseOrder"]),
    totalPrice: t.int(),
    discount: t.float().optional(),
    status: t.string(),
  },
  { withTimestamps: true },
);
export type purchaseOrder = typeof purchaseOrder;
export type PurchaseOrder = t.infer<purchaseOrder>;
