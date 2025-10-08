import { defineConfig } from "@tailor-platform/tailor-sdk";
import { auth } from "./auth";

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
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
  auth,
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
