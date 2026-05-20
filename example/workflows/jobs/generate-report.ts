import { createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../../generated/tailordb";

// This job should NOT be bundled as it's not used by any workflow
export const generateReport = createWorkflowJob({
  name: "generate-report",
  body: async () => {
    const db = getDB("tailordb");
    const orders = await db.selectFrom("SalesOrder").selectAll().execute();
    const invoices = await db.selectFrom("Invoice").selectAll().execute();

    // This is a heavy operation that should be tree-shaken out
    return {
      totalOrders: orders.length,
      totalInvoices: invoices.length,
      reportGeneratedAt: new Date().toISOString(),
    };
  },
});
