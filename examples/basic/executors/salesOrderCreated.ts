import {
  createExecutor,
  recordCreatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { salesOrder } from "../tailordb/salesOrder";

export default createExecutor(
  "sales-order-created",
  "Triggered when a new sales order is created",
)
  .on(
    recordCreatedTrigger(
      salesOrder,
      ({ newRecord }) => (newRecord.totalPrice ?? 0) > 100_0000,
    ),
  )
  .executeGql({
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
  });
