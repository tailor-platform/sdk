import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  name: "tailor-sdk-dev",
  region: "asia-northeast",
  app: {
    "my-app": {
      db: { "my-db": { files: ["./src/tailordb/*.ts"] } },
      resolver: {
        "my-pipeline": { files: ["./src/resolvers/**/resolver.ts"] },
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
          Namespace: "my-db",
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
  generators: [
    "@tailor/sdl",
    ["@tailor/kysely-type", { distPath: "./src/resolvers/db.ts" }],
  ],
  tsConfig: "./tsconfig.json",
});
