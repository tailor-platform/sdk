import { describe, expect, test } from "vitest";
import { mockOperatorClient } from "./operator-client";

describe("mockOperatorClient", () => {
  test("resolves a method given as a response to that response", async () => {
    const client = mockOperatorClient({ getTenantConfig: { tenantProviderConfig: {} } });

    await expect(
      client.getTenantConfig({ workspaceId: "ws", namespaceName: "auth" }),
    ).resolves.toEqual({ tenantProviderConfig: {} });
    expect(client.getTenantConfig).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "ws",
      namespaceName: "auth",
    });
  });

  test("runs a method given as an implementation on each request", async () => {
    const client = mockOperatorClient({
      getTenantConfig: async (request) => ({
        tenantProviderConfig: {
          config: { config: { case: "tailordb", value: { namespace: request.namespaceName } } },
        },
      }),
    });

    await expect(client.getTenantConfig({ namespaceName: "auth" })).resolves.toEqual({
      tenantProviderConfig: {
        config: { config: { case: "tailordb", value: { namespace: "auth" } } },
      },
    });
  });

  test("streams a method given as an async generator", async () => {
    const client = mockOperatorClient({
      async *downloadFunctionRegistryScript() {
        yield {};
      },
    });
    const chunks: unknown[] = [];

    for await (const chunk of client.downloadFunctionRegistryScript({})) chunks.push(chunk);

    expect(chunks).toEqual([{}]);
  });
});
