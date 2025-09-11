import { defineConfig } from "@tailor-platform/tailor-sdk";
import { defaultMachineUserRole } from "./constants";

export default defineConfig({
  id: process.env.WORKSPACE_ID!,
  // name: "tailor-sdk-dev",
  // region: "asia-northeast",
  app: {
    "my-app": {
      cors: [
        "my-frontend:url", // This will be replaced with the actual Static Website URL
      ],
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
      },
      pipeline: {
        "my-pipeline": { files: ["./resolvers/**/resolver.ts"] },
      },
      idp: {
        "my-idp": {
          authorization: "loggedIn",
          clients: ["default-idp-client"],
        },
      },
      auth: {
        namespace: "my-auth",
        idProviderConfigs: [
          {
            Name: "sample",
            Config: {
              Kind: "BuiltInIdP",
              Namespace: "my-idp",
              ClientName: "default-idp-client",
            },
          },
        ],
        userProfileProvider: "TAILORDB",
        userProfileProviderConfig: {
          Kind: "TAILORDB",
          Namespace: "tailordb",
          Type: "User",
          UsernameField: "email",
          AttributesFields: ["roleId"],
          AttributeMap: {
            roleId: "roleId",
          },
        },
        machineUsers: [
          {
            Name: "admin-machine-user",
            Attributes: [defaultMachineUserRole],
            AttributeMap: {
              roleId: defaultMachineUserRole,
            },
          },
        ],
        oauth2Clients: [
          {
            Name: "sample",
            Description: "Sample OAuth2 client",
            GrantTypes: ["authorization_code", "refresh_token"],
            RedirectURIs: [
              "https://example.com/callback",
              "my-frontend:url/callback",
            ],
          },
        ],
      },
    },
  },
  executor: { files: ["./executors/*.ts"] },
  staticWebsites: {
    "my-frontend": {
      description: "my frontend application",
    },
  },
  generators: [
    [
      "@tailor/kysely-type",
      { distPath: ({ tailorDB }) => `./generated/${tailorDB}.ts` },
    ],
    ["@tailor/db-type", { distPath: () => `./generated/types.ts` }],
  ],
});
