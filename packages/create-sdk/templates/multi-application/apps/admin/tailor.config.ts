import { defineConfig } from "@tailor-platform/sdk";
import { sharedDb } from "../user/tailor.config";

export default defineConfig({
  name: "admin",
  db: {
    [sharedDb]: { attach: true },
    "admin-db": { files: [`./db/**/*.ts`] },
  },
});
