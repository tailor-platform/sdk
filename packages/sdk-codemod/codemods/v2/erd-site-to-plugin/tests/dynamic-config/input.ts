import { defineConfig } from "@tailor-platform/sdk";

const db = {
  tailordb: { files: ["./tailordb/*.ts"], erdSite: "my-erd-site" },
};

export default defineConfig({
  name: "my-app",
  db,
});
