import { createExecutor, idpUserCreatedTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "idp-user-created",
  description: "Triggered when an IdP user is created",
  disabled: true,
  trigger: idpUserCreatedTrigger(),
  operation: {
    kind: "webhook",
    url: () => "https://example.com/webhook/idp-user",
    headers: { "Content-Type": "application/json" },
    requestBody: () => ({ notified: true }),
  },
});
