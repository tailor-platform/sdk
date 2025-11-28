import { defineConfig } from "@tailor-platform/sdk";
import { sharedDb } from "../user/tailor.config";

export default defineConfig({
  name: "admin",
  db: {
    [sharedDb]: { external: true },
    "admin-db": { files: [`./apps/admin/db/**/*.ts`] },
  },
});
