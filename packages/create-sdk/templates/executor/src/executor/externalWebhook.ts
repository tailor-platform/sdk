import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";
import { secretmanager } from "@tailor-platform/sdk/runtime";

// Replace with your webhook provider's signature scheme.
async function isValidSignature(rawBody: string, signature: string | undefined, secret: string) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(signature.match(/../g) ?? [], (byte) =>
    parseInt(byte, 16),
  );
  const bodyBytes = Uint8Array.from(atob(rawBody), (char) => char.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, signatureBytes, bodyBytes);
}

export default createExecutor({
  name: "external-webhook",
  description: "Handles incoming webhook events",
  trigger: incomingWebhookTrigger<{
    body: { event: string; payload: Record<string, unknown> };
    headers: Record<string, string>;
  }>(),
  operation: {
    kind: "function",
    body: async (args) => {
      const secret = await secretmanager.getSecret("webhook", "signing-secret");
      if (!secret) {
        throw new Error("Webhook signing secret is not configured");
      }
      if (!(await isValidSignature(args.rawBody, args.headers["x-webhook-signature"], secret))) {
        throw new Error("Invalid webhook signature");
      }
      console.log("Webhook event:", args.body.event);
      console.log("Payload:", args.body.payload);
      console.log("Headers:", args.headers);
    },
  },
});
