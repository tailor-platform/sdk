import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { format } from "date-fns";
import { getDB } from "../generated/tailordb";

export const process_payment = createWorkflowJob({
  name: "process-payment",
  body: async () => {
    const db = getDB("tailordb");
    const invoices = await db.selectFrom("Invoice").selectAll().execute();
    return invoices.reduce(
      (sum, invoice) => [...sum, invoice.status],
      [] as (typeof invoices)[number]["status"][],
    );
  },
});

export const check_inventory = createWorkflowJob({
  name: "check-inventory",
  body: () => format(new Date(), "yyyy-MM-dd HH:mm:ss"),
});

export const validate_order = createWorkflowJob({
  name: "validate-order",
  body: async (input: { orderId: string }) => {
    console.log("Order ID:", input.orderId);
    const inventoryResult = await check_inventory.trigger();
    const paymentResult = await process_payment.trigger();
    return { inventoryResult, paymentResult };
  },
});

export default createWorkflow({
  name: "sample-workflow",
  mainJob: validate_order,
});
