import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export const sumInvoicesByAccount = createWorkflowJob({
  name: "sum-invoices-by-account",
  body: async () => {
    const db = getDB("tailordb");
    const rows = await db
      .selectFrom("Invoice")
      .select(({ fn }) => ["accountId", fn.sum("amount").as("total")])
      .groupBy("accountId")
      .execute();
    return rows.map((row) => ({
      accountId: row.accountId,
      total: Number(row.total),
    }));
  },
});

export default createWorkflow({
  name: "sum-invoices-by-account-workflow",
  mainJob: sumInvoicesByAccount,
});
