import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  id: process.env.WORKSPACE_ID,
  name: "tailor-sdk-dev",
  region: "asia-northeast",
  app: {
    "my-app": {
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
      },
      pipeline: {
        "my-pipeline": { files: ["./resolvers/**/resolver.ts"] },
      },
      auth: {
        namespace: "my-auth",
        idProviderConfigs: [
          {
            Name: "sample",
            Config: {
              Kind: "IDToken",
              ClientID: "exampleco",
              ProviderURL: "https://exampleco-enterprises.auth0.com/",
            },
          },
        ],
        userProfileProvider: "TAILORDB",
        userProfileProviderConfig: {
          Kind: "TAILORDB",
          Namespace: "tailordb",
          Type: "User",
          UsernameField: "email",
          AttributesFields: ["roles"],
        },
        machineUsers: [
          {
            Name: "admin-machine-user",
            Attributes: ["4293a799-4398-55e6-a19a-fe8427d1a415"],
          },
        ],
        oauth2Clients: [],
      },
    },
  },
  executor: { files: ["./executors/*.ts"] },
  generators: [
    "@tailor/sdl",
    ["@tailor/kysely-type", { distPath: ({ tailorDB }) => `./${tailorDB}.ts` }],
    ["@tailor/db-type", { distPath: () => `./tailordb/types.ts` }],
  ],
});
