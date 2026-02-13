import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-013",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
