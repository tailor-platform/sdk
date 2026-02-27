import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { registration } from "../tailordb/registration";

export default createExecutor({
  name: "registration-created",
  description: "Sends webhook when a paid registration is created",
  trigger: recordCreatedTrigger({
    type: registration,
    condition: ({ newRecord }) => newRecord.plan !== "free",
  }),
  operation: {
    kind: "webhook",
    url: ({ newRecord }) => `https://api.billing.example.com/registrations/${newRecord.id}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "billing-service", key: "api-key" },
    },
    requestBody: ({ newRecord }) => ({
      email: newRecord.email,
      name: newRecord.name,
      plan: newRecord.plan,
    }),
  },
});
