import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-002",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
