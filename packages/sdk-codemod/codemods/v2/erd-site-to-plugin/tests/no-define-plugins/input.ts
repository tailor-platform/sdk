import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  db: {
    "my-db": { files: ["./tailordb/*.ts"], erdSite: "my-erd-site" },
  },
});
