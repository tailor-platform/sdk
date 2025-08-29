import { describe, expect, test } from "vitest";

import {
  AuthIDPConfig_AuthType,
  AuthOAuth2Client_GrantType,
  UserProfileProviderConfig_UserProfileProviderType,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { createOperatorClient } from "./utils";
import { defaultMachineUserRole } from "../constants";

describe("controlplane", async () => {
  const [client, workspaceId] = createOperatorClient();
  const namespaceName = "my-auth";

  test("service applied", async () => {
    const { authServices } = await client.listAuthServices({ workspaceId });
    expect(authServices.length).toBe(1);
    expect(authServices[0].namespace?.name).toBe(namespaceName);
  });

  test("idpConfig applied", async () => {
    const { idpConfigs } = await client.listAuthIDPConfigs({
      workspaceId,
      namespaceName,
    });
    expect(idpConfigs.length).toBe(1);
    expect(idpConfigs[0]).toMatchObject({
      name: "sample",
      authType: AuthIDPConfig_AuthType.OIDC,
      config: {
        config: {
          case: "oidc",
          value: {
            usernameClaim: "name",
          },
        },
      },
    });
  });

  test("userProfileConfig applied", async () => {
    const { userProfileProviderConfig } = await client.getUserProfileConfig({
      workspaceId,
      namespaceName,
    });
    expect(userProfileProviderConfig).toMatchObject({
      providerType: UserProfileProviderConfig_UserProfileProviderType.TAILORDB,
      config: {
        config: {
          case: "tailordb",
          value: {
            namespace: "tailordb",
            type: "User",
            usernameField: "email",
            attributesFields: ["roleId"],
            attributeMap: {
              roleId: "roleId",
            },
          },
        },
      },
    });
  });

  test("machineUser applied", async () => {
    const { machineUsers } = await client.listAuthMachineUsers({
      workspaceId,
      authNamespace: namespaceName,
    });
    expect(machineUsers.length).toBe(1);
    expect(machineUsers[0]).toMatchObject({
      name: "admin-machine-user",
      attributes: [defaultMachineUserRole],
      // TODO(remiposo): fix platform
      // attributeMap: {
      //   roleId: defaultMachineUserRole,
      // },
    });
  });

  test("oauth2Client applied", async () => {
    const { oauth2Clients } = await client.listAuthOAuth2Clients({
      workspaceId,
      namespaceName,
    });
    expect(oauth2Clients.length).toBe(1);
    expect(oauth2Clients[0]).toMatchObject({
      name: "sample",
      description: "Sample OAuth2 client",
      grantTypes: [
        AuthOAuth2Client_GrantType.AUTHORIZATION_CODE,
        AuthOAuth2Client_GrantType.REFRESH_TOKEN,
      ],
      redirectUris: ["https://example.com/callback"],
    });
  });
});
