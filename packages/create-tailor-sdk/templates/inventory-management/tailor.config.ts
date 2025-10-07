import { defineConfig } from "@tailor-platform/tailor-sdk";
import { auth } from "./src/auth";

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
      auth,
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
