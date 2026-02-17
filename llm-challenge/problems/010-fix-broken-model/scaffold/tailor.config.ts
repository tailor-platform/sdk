import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-010",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
