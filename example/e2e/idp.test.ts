import { describe, expect, test } from "vitest";
import { createOperatorClient } from "./utils";

describe("control plane", async () => {
  const [client, workspaceId] = createOperatorClient();
  const namespaceName = "my-idp";

  test("service applied", async () => {
    const { idpServices } = await client.listIdPServices({ workspaceId });
    expect(idpServices.length).toBe(1);
    expect(idpServices[0].namespace?.name).toBe(namespaceName);
    const { idpService } = await client.getIdPService({
      workspaceId,
      namespaceName,
    });
    expect(idpService?.userAuthPolicy).toMatchObject({
      useNonEmailIdentifier: false,
      allowSelfPasswordReset: true,
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNonAlphanumeric: true,
      passwordRequireNumeric: true,
      passwordMinLength: 8,
      passwordMaxLength: 128,
    });
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
