import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-032",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
