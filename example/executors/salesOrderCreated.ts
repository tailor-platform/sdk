import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { salesOrder } from "../tailordb/salesOrder";

export default createExecutor({
  name: "sales-order-created",
  description: "Triggered when a new sales order is created",
  trigger: recordCreatedTrigger({
    type: salesOrder,
    condition: ({ newRecord }) => (newRecord.totalPrice ?? 0) > 100_0000,
  }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: /* gql */ `
      mutation createSalesOrderCreated($input: SalesOrderCreatedCreateInput!) {
        createSalesOrderCreated(input: $input) {
          id
        }
      }
    `,
    variables: ({ newRecord }) => ({
      input: {
        salesOrderID: newRecord.id,
        customerID: newRecord.customerID,
        totalPrice: newRecord.totalPrice,
        status: newRecord.status,
      },
    }),
  },
});
