import { defineConfig } from "@tailor-platform/tailor-sdk";

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
      auth: {
        namespace: "main-auth",
        machineUsers: [
          {
            Name: "manager",
            Attributes: [],
            AttributeMap: {
              role: "MANAGER",
            },
          },
          {
            Name: "staff",
            Attributes: [],
            AttributeMap: {
              role: "STAFF",
            },
          },
        ],
      },
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
