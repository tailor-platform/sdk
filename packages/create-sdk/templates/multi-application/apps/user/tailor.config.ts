import { defineConfig } from "@tailor-platform/sdk";

export const sharedDb = "shared-db";

export default defineConfig({
  name: "user",
  db: { [sharedDb]: { files: [`./apps/user/db/**/*.ts`] } },
});
