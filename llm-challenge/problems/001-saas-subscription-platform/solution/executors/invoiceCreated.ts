import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { invoice } from "../tailordb/invoice";

export default createExecutor({
  name: "invoice-created",
  description: "Sends webhook notification when an invoice with positive amount is created",
  trigger: recordCreatedTrigger({
    type: invoice,
    condition: ({ newRecord }) => newRecord.amount > 0,
  }),
  operation: {
    kind: "webhook",
    url: () => "https://billing.example.com/webhooks/invoice",
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "billing-service", key: "BILLING_API_KEY" },
    },
  },
});
