import { mockSecretmanager } from "@tailor-platform/sdk/vitest";
import { describe, expect, test, vi } from "vitest";
import externalWebhook from "./externalWebhook";

const signingSecret = "test-signing-secret";
const orderCreated = { event: "order.created", payload: { orderId: "order-1" } };
// printf '%s' '{"event":"order.created","payload":{"orderId":"order-1"}}' | openssl dgst -sha256 -hmac test-signing-secret
const signature = "5bbadab76801b83787cf5551c49ab7d3d821e849fdffc25ac248b3531dcc67ee";

function runExternalWebhook(headers: Record<string, string>, body = orderCreated) {
  if (externalWebhook.operation.kind !== "function") {
    throw new Error("expected function operation");
  }
  return externalWebhook.operation.body({
    body,
    headers,
    method: "POST",
    rawBody: btoa(JSON.stringify(body)),
    env: {},
    invoker: null,
  });
}

function seedSigningSecret() {
  return mockSecretmanager({ secrets: { webhook: { "signing-secret": signingSecret } } });
}

describe("externalWebhook executor", () => {
  test("logs the event when the signature matches the raw body", async () => {
    using _secrets = seedSigningSecret();
    using log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runExternalWebhook({ "x-webhook-signature": signature });

    expect(log).toHaveBeenCalledWith("Webhook event:", "order.created");
  });

  test("rejects a body that does not match the signature", async () => {
    using _secrets = seedSigningSecret();
    using log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runExternalWebhook(
        { "x-webhook-signature": signature },
        { event: "order.created", payload: { orderId: "order-2" } },
      ),
    ).rejects.toThrow("Invalid webhook signature");
    expect(log).not.toHaveBeenCalled();
  });

  test.each<{ name: string; headers: Record<string, string> }>([
    { name: "missing", headers: {} },
    { name: "non-hex", headers: { "x-webhook-signature": signature.replace("01", "1g") } },
  ])("rejects a $name signature", async ({ headers }) => {
    using _secrets = seedSigningSecret();
    using log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(runExternalWebhook(headers)).rejects.toThrow("Invalid webhook signature");
    expect(log).not.toHaveBeenCalled();
  });

  test("rejects when the webhook vault has no signing secret", async () => {
    using _secrets = mockSecretmanager({ secrets: { webhook: {} } });
    using log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(runExternalWebhook({ "x-webhook-signature": signature })).rejects.toThrow(
      "Webhook signing secret is not configured",
    );
    expect(log).not.toHaveBeenCalled();
  });
});
