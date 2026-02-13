import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-014",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
