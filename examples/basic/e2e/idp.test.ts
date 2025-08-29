import { describe, expect, test } from "vitest";

import { createOperatorClient } from "./utils";

describe("control plane", async () => {
  const [client, workspaceId] = createOperatorClient();
  const namespaceName = "my-idp";

  test("service applied", async () => {
    const { idpServices } = await client.listIdPServices({ workspaceId });
    expect(idpServices.length).toBe(1);
    expect(idpServices[0].namespace?.name).toBe(namespaceName);
  });

  test("client applied", async () => {
    const { clients } = await client.listIdPClients({
      workspaceId,
      namespaceName,
    });
    expect(clients.length).toBe(1);
    expect(clients[0]).toMatchObject({
      name: "default-idp-client",
    });
  });
});
