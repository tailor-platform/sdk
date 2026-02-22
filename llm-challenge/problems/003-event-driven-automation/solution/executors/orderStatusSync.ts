import { createExecutor, recordUpdatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";

export default createExecutor({
  name: "order-status-sync",
  description: "Syncs shipment data when order status changes to shipped",
  trigger: recordUpdatedTrigger({
    type: order,
    condition: ({ newRecord, oldRecord }) =>
      oldRecord.status !== "shipped" && newRecord.status === "shipped",
  }),
  operation: {
    kind: "graphql",
    query: `mutation syncShipment($input: ShipmentSyncInput!) { createShipmentSync(input: $input) { id } }`,
    variables: ({ newRecord }) => ({
      input: {
        orderId: newRecord.id,
        customerName: newRecord.customerName,
        shippingAddress: newRecord.shippingAddress ?? "",
      },
    }),
  },
});
