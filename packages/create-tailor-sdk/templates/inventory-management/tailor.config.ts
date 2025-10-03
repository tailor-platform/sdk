import { defineAuth, defineConfig } from "@tailor-platform/tailor-sdk";
import { user } from "./src/db/user";

export default defineConfig({
  id: process.env.WORKSPACE_ID!,
  app: {
    "inventory-management": {
      db: {
        "main-db": {
          files: [`./src/db/*.ts`],
        },
      },
      pipeline: {
        "main-pipeline": {
          files: [`./src/pipeline/*.ts`],
        },
      },
      auth: defineAuth("main-auth", {
        userProfile: {
          type: user,
          usernameField: "email",
          attributes: {
            role: true,
          },
        },
        machineUsers: {
          manager: {
            attributes: { role: "MANAGER" },
          },
          staff: {
            attributes: { role: "STAFF" },
          },
        },
      }),
    },
  },
  executor: {
    files: ["./src/executor/*.ts"],
  },
  generators: [
    [
      "@tailor/kysely-type",
      { distPath: ({ tailorDB }) => `./src/generated/${tailorDB}.ts` },
    ],
  ],
});
