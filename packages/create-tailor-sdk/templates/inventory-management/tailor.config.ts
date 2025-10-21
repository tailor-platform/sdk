import { defineConfig, defineGenerators } from "@tailor-platform/tailor-sdk";
import { auth } from "./src/auth";

if (!process.env.WORKSPACE_ID) {
  throw new Error("WORKSPACE_ID environment variable is not set");
}

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID,
  name: "inventory-management",
  db: { "main-db": { files: [`./src/db/*.ts`] } },
  pipeline: { "main-pipeline": { files: [`./src/pipeline/*.ts`] } },
  auth,
  executor: { files: ["./src/executor/*.ts"] },
});

export const generators = defineGenerators([
  "@tailor/kysely-type",
  { distPath: ({ tailorDB }) => `./src/generated/${tailorDB}.ts` },
]);
