import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export const sumInvoices = createWorkflowJob({
  name: "sum-invoices",
  body: async () => {
    const db = getDB("tailordb");
    const rows = await db.selectFrom("Invoice").select(["amount"]).execute();
    return rows.reduce((acc, row) => acc + Number(row.amount), 0);
  },
});

export default createWorkflow({
  name: "sum-invoices-workflow",
  mainJob: sumInvoices,
});
